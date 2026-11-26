import assert from 'node:assert/strict';
import worker, { generateAiPlan, runAiTextWithFallback, runAiInferenceWithTimeout, runGroqInferenceWithTimeout, aiPlanDiagnostic, aiDataFlowDiagnostic, buildLocalPlanChatReply, buildLocalPremiumDiaryReview, FOOD_CATALOG, buildPlanResponseSchema, diagnosePlanWeekFailure, rebalanceDayNutrition, foodAllowedByPreferences, foodRole, foodCanReplaceFood, foodFitsMeal } from '../_worker.js';
import { readFile } from 'node:fs/promises';

const workerSource = await readFile(new URL('../_worker.js', import.meta.url), 'utf8');
for (const example of [
  '"breakfastIngredients":[{"foodId":"oats_dry","grams":60},{"foodId":"banana","grams":50}]',
  '"lunchIngredients":[{"foodId":"chicken_raw","grams":120},{"foodId":"rice_dry","grams":50}]',
  '"snackIngredients":[{"foodId":"greek_yogurt","grams":150},{"foodId":"blueberries","grams":50}]',
  '"dinnerIngredients":[{"foodId":"salmon_raw","grams":120},{"foodId":"broccoli","grams":100}]'
]) {
  assert.ok(workerSource.includes(example),
    'the AI prompt example must show at least two real catalog ingredients in every meal');
}
const wranglerSource = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
assert.ok(!wranglerSource.includes('"FITALPRO_REQUIRE_GROQ": "1"'),
  'Preview must use the same provider fallback chain as Production when Groq quota is exhausted');
assert.ok(wranglerSource.includes('"ROBOKASSA_IS_TEST": "0"') &&
  wranglerSource.includes('"ROBOKASSA_IS_TEST": "1"'),
  'Production must remain in live mode while Preview explicitly uses Robokassa test mode');
const previewCheckoutBlocked = await worker.fetch(new Request('https://fitalpro.test/api/checkout', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ plan: 'Питание' })
}), { FITALPRO_PREVIEW_CI: '1' });
assert.equal(previewCheckoutBlocked.status, 503, 'Preview must block public checkout writes to the shared production D1');
const previewWebhookBlocked = await worker.fetch(new Request('https://fitalpro.test/webhooks/robokassa', {
  method: 'GET'
}), { FITALPRO_PREVIEW_CI: '1' });
assert.equal(previewWebhookBlocked.status, 503, 'Preview must block public payment webhooks');
const previewDiagnosticStillProtected = await worker.fetch(new Request('https://fitalpro.test/api/ai-data-flow-diagnostic', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ plan: 'Питание' })
}), { FITALPRO_PREVIEW_CI: '1' });
assert.equal(previewDiagnosticStillProtected.status, 404, 'Preview diagnostic must remain available only to authenticated CI');
const healthSchemaColumns = {
  request_log: ['ip_hash', 'route', 'created_at'],
  subscriptions: ['id', 'payment_id', 'client_ref', 'plan', 'status', 'access_token', 'customer_contact', 'created_at', 'updated_at', 'expires_at'],
  payments: ['id', 'status', 'plan', 'amount', 'currency', 'created_at'],
  profiles: ['access_token', 'profile_json', 'updated_at'],
  weekly_plans: ['id', 'access_token', 'plan_json', 'created_at', 'updated_at'],
  progress: ['access_token', 'date', 'weight', 'completed_meal', 'completed_workout', 'note'],
  leads: ['id', 'name', 'contact', 'goal', 'plan', 'created_at']
};
function makeHealthDb(missingTable = null) {
  return {
    prepare(sql) {
      const match = sql.match(/^PRAGMA table_info\(([^)]+)\)$/);
      assert.ok(match, 'health must use read-only PRAGMA schema checks');
      const table = match[1];
      return {
        async all() {
          return { results: table === missingTable ? [] : (healthSchemaColumns[table] || []).map(name => ({ name })) };
        }
      };
    }
  };
}
const healthWithGroq = await worker.fetch(new Request('https://fitalpro.test/health'), {
  AI: {},
  DB: makeHealthDb(),
  GROQ_API_KEY: 'test-groq-secret'
});
const healthWithGroqBody = await healthWithGroq.json();
assert.equal(healthWithGroqBody.groq, true, 'health must report Groq configuration without exposing its value');
assert.equal(healthWithGroqBody.db, true, 'health must confirm that all required D1 tables and columns are readable');
assert.equal(Object.values(healthWithGroqBody).includes('test-groq-secret'), false, 'health must never expose the Groq secret');
const healthWithoutGroq = await worker.fetch(new Request('https://fitalpro.test/health'), { AI: {}, DB: makeHealthDb() });
const healthWithoutGroqBody = await healthWithoutGroq.json();
assert.equal(healthWithoutGroqBody.groq, false, 'health must report when the Preview Groq secret is missing');
assert.equal(healthWithoutGroqBody.db, true, 'D1 schema readiness must be independent of Groq configuration');
const healthWithBrokenD1 = await worker.fetch(new Request('https://fitalpro.test/health'), { AI: {}, DB: makeHealthDb('payments') });
assert.equal((await healthWithBrokenD1.json()).db, false, 'health must fail closed when a required D1 table is missing');
const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const htmlSource = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
assert.ok(htmlSource.includes('Если ИИ временно недоступен или не может сформировать полный проверенный план, заказ и оплата не создаются') &&
  htmlSource.includes('Если все генеративные модели недоступны или не формируют полный проверенный план, заказ и оплата не создаются') &&
  !htmlSource.includes('иначе план рассчитывается сервером по справочнику продуктов') &&
  !htmlSource.includes('При недоступности генеративных моделей план рассчитывается по серверному справочнику продуктов и формулам Fital Pro'),
  'the public questionnaire must not promise a catalog fallback when checkout correctly fails closed without a complete AI plan');
const productionWorkflow = await readFile(new URL('../.github/workflows/main.yml', import.meta.url), 'utf8');
const pullRequestWorkflow = await readFile(new URL('../.github/workflows/pull-request-checks.yml', import.meta.url), 'utf8');
const liveIntegrationSource = await readFile(new URL('../scripts/live-ai-plan-validation.mjs', import.meta.url), 'utf8');
assert.ok(productionWorkflow.includes(
  "concurrency:\n  group: fital-pro-production\n  cancel-in-progress: false\n  queue: max"
), 'Production workflow runs must share a non-cancelling lock and retain queued runs instead of replacing them');
assert.ok(productionWorkflow.includes(
  "  deploy:\n    if: github.ref == 'refs/heads/main' && (github.event_name != 'workflow_dispatch' || inputs.run_live_ai != true)"
), 'a manual live-AI validation dispatch must skip Production deployment');
assert.ok(productionWorkflow.includes(
  "  live-ai-plans:\n    if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && inputs.run_live_ai == true"
), 'real AI validation must run only on an explicit manual opt-in');
assert.ok(!productionWorkflow.includes('group: fital-pro-live-ai-plans') &&
  !productionWorkflow.includes('cancel-in-progress: true'),
  'Production deploy and live AI validation must not use independent or preemptive concurrency locks');

assert.ok(liveIntegrationSource.includes("[0-9]+\\s*(?:[×xх]\\s*[0-9]+|подход(?:а|ов)?|повтор(?:а|ений)?)") &&
  !liveIntegrationSource.includes("[0-9]+[ \\t]*"),
  'live workout validation must accept line breaks between set counts and repetitions just like the server validator');
assert.ok(liveIntegrationSource.includes('!day.workout.trim()') &&
  !liveIntegrationSource.includes('day.workout.trim().length < 15') &&
  liveIntegrationSource.includes('[0-9]+\\s*(?:[×xх]\\s*[0-9]+|подход(?:а|ов)?|повтор(?:а|ений)?)'),
  'live workout validation must match server rules: non-empty workout and a prescription on training days, including multiline spacing');
assert.ok(liveIntegrationSource.includes("const includesTraining = item.key !== 'Питание'") &&
  liveIntegrationSource.includes("const expectedTrainingDays = item.key === 'Питание' ? 0") &&
  liveIntegrationSource.includes('const expectedTrainingDay = includesTraining &&'),
  'the 7-day nutrition tariff must not be validated against the PRO workout schedule');
assert.ok(pullRequestWorkflow.includes('--name fital-pro-redesign-groq-ready') &&
  liveIntegrationSource.includes("hostname.startsWith('fital-pro-redesign-groq-ready-red-waterfall-2af8.')"),
  'the full Preview integration script must accept the exact Worker Preview name published by the PR workflow');
const productionWorkflowSource = productionWorkflow;
assert.ok(productionWorkflowSource.includes('if [ -n "$GROQ_API_KEY" ]') &&
  productionWorkflowSource.includes('wrangler secret put GROQ_API_KEY --name red-waterfall-2af8') &&
  !productionWorkflowSource.includes('d.groq!==true'),
  'Production deployment must treat Groq as optional and retain the Cloudflare Workers AI fallback');
assert.ok(liveIntegrationSource.includes("data.groq === true") &&
  !liveIntegrationSource.includes("result.aiProviders.includes('groq')"),
  'the live AI validator must accept either configured Groq or the Cloudflare Workers AI fallback');
assert.ok(liveIntegrationSource.includes('day.calculatedNutrition.calories < result.targets.calories * 0.90') &&
  liveIntegrationSource.includes('day.calculatedNutrition.calories > result.targets.calories * 1.10') &&
  liveIntegrationSource.includes('day.calculatedNutrition[key] >= 0'),
  'live AI validation must enforce ±10% calories separately for every day and only finite nonnegative macros');
assert.ok(liveIntegrationSource.includes("{ key: 'Питание', days: 7 }") &&
  liveIntegrationSource.includes("{ key: 'PRO', days: 14 }") &&
  liveIntegrationSource.includes("{ key: 'Premium', days: 30 }") &&
  liveIntegrationSource.includes('expectedTrainingDays') &&
  !liveIntegrationSource.includes('trainingDays !== 6'),
  'live Preview AI validation must cover all three paid durations and derive the correct workout count for each');
assert.ok(workerSource.includes('aiFailureDiagnostic(error, 1200)'),
  'authenticated live AI diagnostics must preserve the sanitized nested provider failure reason');
assert.ok(productionWorkflow.includes('FITALPRO_AI_TARGET: production') &&
  productionWorkflow.includes('FITALPRO_WORKER_URL: https://red-waterfall-2af8.vladimirdemenin5.workers.dev') &&
  productionWorkflow.includes('node scripts/live-ai-plan-validation.mjs') &&
  productionWorkflow.includes('timeout-minutes: 90') &&
  !productionWorkflow.includes('node scripts/live-ai-plans.mjs'),
  'the optional production AI check must target the existing production Worker and use the no-D1-write AI diagnostic');
assert.ok(Object.entries(FOOD_CATALOG).length >= 30, 'food reference catalog must remain populated');
assert.ok(productionWorkflow.includes("if: github.event_name == 'workflow_dispatch' && inputs.run_live_ai == true"),
  'live AI generation must require an explicit manual workflow dispatch so ordinary production deployments do not consume Workers AI quota');
assert.ok(productionWorkflow.includes('run_live_ai:') && productionWorkflow.includes('type: boolean') && productionWorkflow.includes('default: false'),
  'manual live AI checks must default to off');
assert.ok(liveIntegrationSource.includes("endpoint + '/api/ai-diagnostic'") &&
  liveIntegrationSource.includes('payment: \'not created\'') &&
  liveIntegrationSource.includes('persistence: \'not performed\''),
  'the AI-only Preview validation must use the no-D1-write diagnostic and must not require an isolated Preview database');
function getWorkflowStepCondition(source, stepName) {
  const marker = `      - name: ${stepName}`;
  const start = source.indexOf(marker);
  if (start === -1) return '';
  const nextStep = source.indexOf('\n      - name:', start + marker.length);
  const stepBlock = source.slice(start, nextStep === -1 ? source.length : nextStep);
  const conditionLine = stepBlock.split('\n').find(line => line.trimStart().startsWith('if:'));
  return conditionLine ? conditionLine.slice(conditionLine.indexOf('if:') + 3).trim() : '';
}

const liveAiCondition = getWorkflowStepCondition(
  pullRequestWorkflow,
  'Verify the real 7-day and 14-day AI plans without database writes'
);
const livePaymentCondition = getWorkflowStepCondition(
  pullRequestWorkflow,
  'Verify Robokassa, D1 persistence, and member access for all tariffs'
);
const livePremiumAiCondition = getWorkflowStepCondition(
  pullRequestWorkflow,
  'Verify the real 30-day Premium AI plan without database writes'
);
assert.ok(livePremiumAiCondition.includes("github.event_name == 'pull_request'") &&
  livePremiumAiCondition.includes("contains(github.event.pull_request.labels.*.name, 'run-live-premium-ai-check')") &&
  pullRequestWorkflow.includes('FITALPRO_AI_PLANS: Premium'),
  '30-day Premium live generation must be an explicit separate opt-in and must validate Premium only');
assert.ok(pullRequestWorkflow.includes('types: [opened, synchronize, reopened, labeled]') &&
  liveAiCondition.includes("github.event_name == 'pull_request'") &&
  liveAiCondition.includes("contains(github.event.pull_request.labels.*.name, 'run-live-ai-check')") &&
  livePaymentCondition.includes("github.event_name == 'pull_request'") &&
  livePaymentCondition.includes("contains(github.event.pull_request.labels.*.name, 'run-live-payment-flow')"),
  'each live integration step must itself require a pull_request event and its own explicit PR label');
assert.ok(Object.entries(FOOD_CATALOG).every(([id, food]) => Number.isFinite(food.kcal) && Number.isFinite(food.protein) && Number.isFinite(food.fat) && Number.isFinite(food.carbs)), 'every food must define calories, protein, fat and carbohydrates');

function nutritionWithinTargetsForTest(n, t) {
  return [n.calories,n.protein,n.fat,n.carbs].every(value=>Number.isFinite(value)&&value>=0) &&
    n.calories >= t.calories * 0.90 && n.calories <= t.calories * 1.10;
}

const profile = {
  name: 'Тестовый клиент',
  sex: 'female',
  age: 30,
  height: 170,
  weight: 70,
  activity: 'medium',
  goal: 'maintenance',
  training: 'mixed',
  days: 3,
  preferences: 'Без ограничений'
};

function makeAi(menuDays, wrongLength = false, invalidMeal = false, invalidWorkout = false, invalidNutrition = false, portionScale = 1) {
  return {
    async run(model, input) {
      const prompt = Array.isArray(input?.messages)
        ? input.messages.map(message => typeof message?.content === 'string' ? message.content : '').join('\n')
        : '';
      const block = prompt.match(/БЛОК: дни ([0-9]+)[–-]([0-9]+) из ([0-9]+)/);
      const requestedDays = block ? Number(block[2]) - Number(block[1]) + 1 : menuDays;
      const count = wrongLength ? Math.max(0, requestedDays - 1) : requestedDays;
      const week = Array.from({ length: count }, (_, index) => {
        const chunkStartMatch = prompt.match(/от День (\d+)/);
        const chunkStartDay = chunkStartMatch ? Number(chunkStartMatch[1]) : 1;
        const dayInWeek = (chunkStartDay - 1 + index) % 7;
        const sessions = Math.max(0, Math.min(7, Math.round(Number(profile.days) || 0)));
        const trainingDay = Math.floor((dayInWeek + 1) * sessions / 7) > Math.floor(dayInWeek * sessions / 7);
        const tiny = invalidNutrition;
        const portion = grams => Math.max(5, Math.round(grams * portionScale));
        return {
          day: 'День ' + (index + 1),
          trainingDay,
          breakfast: 'Овсяная каша с бананом',
          breakfastRecipe: 'Свари хлопья на молоке до мягкости и добавь нарезанный банан.',
          breakfastIngredients: invalidMeal ? [] : (tiny ? [['oats_dry', 5]] : [['oats_dry', portion(80)], ['milk_2pct', portion(200)], ['banana', portion(120)]]).map(([foodId, grams]) => ({ foodId, grams })),
          lunch: 'Курица с рисом и брокколи',
          lunchRecipe: 'Отвари рис, запеки курицу и приготовь брокколи на пару.',
          lunchIngredients: (tiny ? [['chicken_raw', 5]] : [['chicken_raw', portion(100)], ['rice_dry', portion(85)], ['broccoli', portion(100)]]).map(([foodId, grams]) => ({ foodId, grams })),
          snack: 'Йогурт с яблоком и миндалём',
          snackRecipe: 'Нарежь яблоко и подай с йогуртом и миндалём.',
          snackIngredients: (tiny ? [['greek_yogurt', 5]] : [['greek_yogurt', portion(150)], ['apple', portion(150)], ['almonds', portion(15)]]).map(([foodId, grams]) => ({ foodId, grams })),
          dinner: 'Лосось с картофелем и овощами',
          dinnerRecipe: 'Запеки лосось с картофелем, подай с овощами.',
          dinnerIngredients: (tiny ? [['salmon_raw', 5]] : [['salmon_raw', portion(100)], ['potato_raw', portion(200)], ['olive_oil', portion(28)], ['tomato', portion(100)], ['avocado', portion(50)]]).map(([foodId, grams]) => ({ foodId, grams })),
          workout: trainingDay ? (invalidWorkout ? 'Разминка, приседания и тяга' : 'Разминка, приседания 3×10, тяга 3×10, заминка') : 'Прогулка и восстановление'
        };
      });
      return { response: JSON.stringify({ intro: 'План создан по тестовой анкете.', week, tips: ['Пейте воду по жажде.'] }) };
    }
  };
}

function makeRetryAi(menuDays, firstScale, retryScale) {
  let calls = 0;
  return {
    get calls() { return calls; },
    async run(model, input) {
      calls++;
      const scale = calls === 1 ? firstScale : retryScale;
      return makeAi(menuDays, false, false, false, false, scale).run(model, input);
    }
  };
}

assert.ok(Object.keys(FOOD_CATALOG).every(id => foodRole(id)), 'every catalog item must have a meal role');
assert.equal(foodCanReplaceFood('chicken_raw', 'turkey_raw'), true, 'poultry may be substituted with poultry');
assert.equal(foodCanReplaceFood('chicken_raw', 'banana'), false, 'protein must not be replaced with fruit');
assert.equal(foodCanReplaceFood('rice_dry', 'buckwheat_dry'), true, 'grain may be substituted with another grain');
assert.equal(foodCanReplaceFood('rice_dry', 'chicken_raw'), false, 'grain must not be replaced with meat');
assert.equal(foodFitsMeal('cod_raw', 'dinner'), true, 'fish is compatible with dinner');
assert.equal(foodFitsMeal('cod_raw', 'snack'), false, 'fish must not be auto-added to a snack');
assert.equal(foodFitsMeal('banana', 'snack'), true, 'fruit is compatible with a snack');
assert.equal(foodFitsMeal('banana', 'dinner'), false, 'fruit must not be auto-added as a dinner component');

const portionCorrectionDay = {
 day:'День 1',trainingDay:false,
 breakfast:'Овсянка с бананом',breakfastRecipe:'Свари хлопья на молоке и добавь нарезанный банан.',
 breakfastIngredients:[{foodId:'oats_dry',name:FOOD_CATALOG.oats_dry.name,grams:80},{foodId:'milk_2pct',name:FOOD_CATALOG.milk_2pct.name,grams:200},{foodId:'banana',name:FOOD_CATALOG.banana.name,grams:120}],
 lunch:'Курица с рисом',lunchRecipe:'Отвари рис, приготовь курицу и подай с брокколи.',
 lunchIngredients:[{foodId:'chicken_raw',name:FOOD_CATALOG.chicken_raw.name,grams:100},{foodId:'rice_dry',name:FOOD_CATALOG.rice_dry.name,grams:85},{foodId:'broccoli',name:FOOD_CATALOG.broccoli.name,grams:100}],
 snack:'Йогурт с яблоком',snackRecipe:'Нарежь яблоко и подай с йогуртом и миндалём.',
 snackIngredients:[{foodId:'greek_yogurt',name:FOOD_CATALOG.greek_yogurt.name,grams:150},{foodId:'apple',name:FOOD_CATALOG.apple.name,grams:150},{foodId:'almonds',name:FOOD_CATALOG.almonds.name,grams:15}],
 dinner:'Лосось с картофелем',dinnerRecipe:'Запеки лосось с картофелем и овощами.',
 dinnerIngredients:[{foodId:'salmon_raw',name:FOOD_CATALOG.salmon_raw.name,grams:100},{foodId:'potato_raw',name:FOOD_CATALOG.potato_raw.name,grams:200},{foodId:'olive_oil',name:FOOD_CATALOG.olive_oil.name,grams:20},{foodId:'tomato',name:FOOD_CATALOG.tomato.name,grams:100},{foodId:'avocado',name:FOOD_CATALOG.avocado.name,grams:50}]
};
const selectedFoodIds=['breakfast','lunch','snack','dinner'].flatMap(key=>portionCorrectionDay[key+'Ingredients'].map(item=>item.foodId));
assert.equal(rebalanceDayNutrition(portionCorrectionDay,{calories:1900,protein:90,fat:58,carbs:225},profile),true,
 'portion correction must bring an achievable day into the calorie band');
assert.deepEqual(['breakfast','lunch','snack','dinner'].flatMap(key=>portionCorrectionDay[key+'Ingredients'].map(item=>item.foodId)),selectedFoodIds,
 'calorie correction must never add, remove, or replace selected foods');
assert.ok(portionCorrectionDay.nutrition.calories>=1710&&portionCorrectionDay.nutrition.calories<=2090);
assert.ok(nutritionWithinTargetsForTest(portionCorrectionDay.nutrition,{calories:1900}));
assert.ok(['breakfast','lunch','snack','dinner'].every(key=>portionCorrectionDay[key+'Ingredients'].every(item=>item.grams>=5&&item.grams<=500)));
assert.ok(portionCorrectionDay.dinnerIngredients.find(item=>item.foodId==='olive_oil').grams<=20,
 'product-specific portion ceilings must remain enforced');
const lowEnergyDay={
 ...portionCorrectionDay,
 breakfastIngredients:[{foodId:'oats_dry',name:FOOD_CATALOG.oats_dry.name,grams:5}],
 lunchIngredients:[{foodId:'chicken_raw',name:FOOD_CATALOG.chicken_raw.name,grams:5}],
 snackIngredients:[{foodId:'greek_yogurt',name:FOOD_CATALOG.greek_yogurt.name,grams:5}],
 dinnerIngredients:[{foodId:'cod_raw',name:FOOD_CATALOG.cod_raw.name,grams:5}]
};
const lowEnergyFoodIds=['breakfast','lunch','snack','dinner'].flatMap(key=>lowEnergyDay[key+'Ingredients'].map(item=>item.foodId));
assert.equal(rebalanceDayNutrition(lowEnergyDay,{calories:1800,protein:90,fat:58,carbs:225},profile),false,
 'an infeasible day must be rejected when existing foods cannot reach the calorie band within portion limits');
assert.deepEqual(['breakfast','lunch','snack','dinner'].flatMap(key=>lowEnergyDay[key+'Ingredients'].map(item=>item.foodId)),lowEnergyFoodIds,
 'a failed correction must preserve the original selected foods');

const timeoutSignalCapture = { signal: null };
await assert.rejects(
  () => runAiInferenceWithTimeout({
    AI: {
      run(_model, _inputs, options) {
        timeoutSignalCapture.signal = options.signal;
        return new Promise(() => {});
      }
    }
  }, 'test-stalled-model', {}, 5),
  error => error?.name === 'TimeoutError',
  'the inference wrapper must reject even if the AI binding never settles'
);
assert.equal(timeoutSignalCapture.signal.aborted, true, 'a model timeout must also abort the underlying AI call');

// Groq gets bounded retries for transient HTTP/network failures before provider fallback.
const originalFetch = globalThis.fetch;
let groqTransientCalls = 0;
try {
  globalThis.fetch = async () => {
    groqTransientCalls++;
    return groqTransientCalls === 1
      ? new Response('temporary upstream failure', { status: 503 })
      : new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), {
          status: 200, headers: { 'content-type': 'application/json' }
        });
  };
  const recoveredGroq = await runGroqInferenceWithTimeout({ GROQ_API_KEY: 'test-groq-key' }, 'openai/gpt-oss-20b', {}, 1000);
  assert.equal(groqTransientCalls, 2, 'a transient Groq 5xx must be retried once');
  assert.equal(recoveredGroq.choices[0].message.content, '{"ok":true}');

  let groqRateLimitCalls = 0;
  globalThis.fetch = async () => {
    groqRateLimitCalls++;
    return groqRateLimitCalls === 1
      ? new Response(JSON.stringify({ error: { message: 'TPM rate limit reached' } }), {
          status: 429,
          headers: { 'content-type': 'application/json', 'x-ratelimit-reset-tokens': '0.001s' }
        })
      : new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), {
          status: 200, headers: { 'content-type': 'application/json' }
        });
  };
  const recoveredRateLimit = await runGroqInferenceWithTimeout({ GROQ_API_KEY: 'test-groq-key' }, 'openai/gpt-oss-20b', {}, 1000);
  assert.equal(groqRateLimitCalls, 2, 'a Groq 429 must retry after the provider token-reset header even when retry-after is absent');
  assert.equal(recoveredRateLimit.choices[0].message.content, '{"ok":true}');

  let groqRepeatedRateLimitCalls = 0;
  globalThis.fetch = async () => {
    groqRepeatedRateLimitCalls++;
    return groqRepeatedRateLimitCalls <= 2
      ? new Response(JSON.stringify({ error: { message: 'TPM rate limit reached' } }), {
          status: 429,
          headers: { 'content-type': 'application/json', 'x-ratelimit-reset-tokens': '0.001s' }
        })
      : new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), {
          status: 200, headers: { 'content-type': 'application/json' }
        });
  };
  const recoveredRepeatedRateLimit = await runGroqInferenceWithTimeout({ GROQ_API_KEY: 'test-groq-key' }, 'openai/gpt-oss-20b', {}, 1000);
  assert.equal(groqRepeatedRateLimitCalls, 3, 'Groq inference must survive two consecutive TPM windows before succeeding on its third bounded attempt');
  assert.equal(recoveredRepeatedRateLimit.choices[0].message.content, '{"ok":true}');

  let groqDailyQuotaCalls = 0;
  globalThis.fetch = async () => {
    groqDailyQuotaCalls++;
    return new Response(JSON.stringify({
      error: { message: 'Rate limit reached on tokens per day (TPD): Limit 200000, Used 196704, Requested 4256' }
    }), {
      status: 429,
      headers: { 'content-type': 'application/json', 'retry-after': '3600' }
    });
  };
  await assert.rejects(
    () => runGroqInferenceWithTimeout({ GROQ_API_KEY: 'test-groq-key' }, 'openai/gpt-oss-20b', {}, 1000),
    /Groq inference HTTP 429/,
    'a daily token quota must be surfaced immediately so runPlanModel can fail over to another provider'
  );
  assert.equal(groqDailyQuotaCalls, 1, 'a daily token quota must not waste retries waiting for an hourly reset');

  let groqPermanentCalls = 0;
  globalThis.fetch = async () => {
    groqPermanentCalls++;
    return new Response('invalid credentials', { status: 401 });
  };
  await assert.rejects(
    () => runGroqInferenceWithTimeout({ GROQ_API_KEY: 'test-groq-key' }, 'openai/gpt-oss-20b', {}, 1000),
    /Groq inference HTTP 401/,
    'permanent Groq authentication errors must be passed to the existing fallback without retry'
  );
  assert.equal(groqPermanentCalls, 1, 'a Groq 401 must not be retried');
} finally {
  globalThis.fetch = originalFetch;
}


const quotaAttemptedModels=[];
await assert.rejects(()=>generateAiPlan(profile,'Питание',{AI:{async run(model){quotaAttemptedModels.push(model);throw new Error('4006: you have used up your daily free allocation of 10,000 neurons');}}}),
 /временно не смог подготовить полный персональный план/i,
 'an exhausted Workers AI quota must fail closed instead of returning a catalog plan');
assert.equal(quotaAttemptedModels.length,1);
assert.equal(quotaAttemptedModels[0],'@cf/google/gemma-4-26b-a4b-it');
const groqRequiredCalls=[];
await assert.rejects(()=>generateAiPlan(profile,'Питание',{FITALPRO_REQUIRE_GROQ:'1',AI:{async run(model){groqRequiredCalls.push(model);throw new Error('Cloudflare AI must not be called');}}}),
 /временно не смог подготовить полный персональный план/i,
 'missing required Groq credentials must not fall back to a catalog plan');
assert.equal(groqRequiredCalls.length,0);
const originalGroqRequiredFetch=globalThis.fetch;
let groqRequiredHttpCalls=0,groqRequiredCloudflareCalls=0;
try{
 globalThis.fetch=async()=>{groqRequiredHttpCalls++;return new Response('invalid credentials',{status:401});};
 await assert.rejects(()=>generateAiPlan(profile,'Питание',{FITALPRO_REQUIRE_GROQ:'1',GROQ_API_KEY:'test-groq-key',AI:{async run(){groqRequiredCloudflareCalls++;throw new Error('Cloudflare fallback must remain disabled');}}}),
  /временно не смог подготовить полный персональный план/i,
  'a permanent Groq authentication failure must fail closed');
 assert.equal(groqRequiredHttpCalls,1);
 assert.equal(groqRequiredCloudflareCalls,0);
}finally{globalThis.fetch=originalGroqRequiredFetch;}

let groqModelFallbackCalls = [];
let groqStrictSchemaCalls = 0;
let groqUnboundedArraySchemaCalls = 0;
let groqCatalogEnumSchemaCalls = 0;
let groqBoundedGramSchemaCalls = 0;
try {
  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(init.body);
    groqModelFallbackCalls.push(payload.model);
    if (payload.response_format?.type === 'json_schema' &&
        payload.response_format.json_schema?.strict === true &&
        payload.response_format.json_schema.schema?.required?.includes('week')) {
      groqStrictSchemaCalls++;
      const schema = payload.response_format.json_schema.schema;
      if (schema.properties?.week?.minItems === undefined && schema.properties?.week?.maxItems === undefined) {
        groqUnboundedArraySchemaCalls++;
      }
      const ingredientSchema = schema.properties?.week?.items?.properties?.breakfastIngredients?.items;
      if (Array.isArray(ingredientSchema?.properties?.foodId?.enum) &&
          ingredientSchema.properties.foodId.enum.length === Object.keys(FOOD_CATALOG).length) {
        groqCatalogEnumSchemaCalls++;
      }
      if (ingredientSchema?.properties?.grams?.minimum === 5 &&
          ingredientSchema.properties.grams.maximum === 500) {
        groqBoundedGramSchemaCalls++;
      }
    }
    if (payload.model === 'openai/gpt-oss-20b') {
      return new Response(JSON.stringify({ error: { message: 'TPM rate limit reached' } }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'x-ratelimit-reset-tokens': '0.001s' }
      });
    }
    const fixture = await makeAi(7).run(payload.model, { messages: payload.messages });
    return new Response(JSON.stringify({
      choices: [{ message: { content: fixture.response }, finish_reason: 'stop' }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const alternateGroqPlan = await generateAiPlan(profile, 'Питание', {
    FITALPRO_REQUIRE_GROQ: '1',
    GROQ_API_KEY: 'test-groq-key',
    AI: { async run() { throw new Error('Cloudflare fallback must remain disabled'); } }
  });
  assert.equal(alternateGroqPlan.generationMode, 'ai',
    'a rate-limited GPT-OSS 20B must fall back to the independent Groq GPT-OSS 120B model');
  assert.deepEqual(alternateGroqPlan.aiProviders, ['groq']);
  assert.equal(alternateGroqPlan.week.length, 7);
  assert.equal(groqModelFallbackCalls.filter(model => model === 'openai/gpt-oss-20b').length, 3,
    'the rate-limited primary model gets two bounded retries before switching providers');
  assert.equal(groqModelFallbackCalls.filter(model => model === 'openai/gpt-oss-120b').length, 3,
    'after GPT-OSS 120B succeeds, all remaining plan blocks must continue using it');
  assert.equal(groqStrictSchemaCalls, 6,
    'the three bounded primary attempts and all three alternate-model blocks must use strict JSON Schema output');
  assert.equal(groqUnboundedArraySchemaCalls, 6,
    'Groq schema must avoid unsupported array-length constraints; the server enforces the exact number of days');
  assert.equal(groqCatalogEnumSchemaCalls, 6,
    'Groq strict schema must restrict every generated foodId to the client-allowed food catalog');
  assert.equal(groqBoundedGramSchemaCalls, 6,
    'Groq strict schema must constrain ingredient grams to the safe 5–500 gram range');
} finally {
  globalThis.fetch = originalGroqRequiredFetch;
}

let groqCorrectionCalls = 0;
let groqCorrectionCloudflareCalls = 0;
try {
  globalThis.fetch = async (_url, init) => {
    groqCorrectionCalls++;
    const payload = JSON.parse(init.body);
    const draft = await makeAi(7, false, false, false, groqCorrectionCalls === 1)
      .run(payload.model, { messages: payload.messages });
    return new Response(JSON.stringify({
      choices: [{ message: { content: draft.response }, finish_reason: 'stop' }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const correctedGroqPlan = await generateAiPlan(profile, 'Питание', {
    FITALPRO_REQUIRE_GROQ: '1',
    GROQ_API_KEY: 'test-groq-key',
    AI: { async run() { groqCorrectionCloudflareCalls++; throw new Error('Cloudflare fallback must remain disabled'); } }
  });
  assert.equal(correctedGroqPlan.generationMode, 'ai',
    'Groq must recover from a nutritionally rejected first draft using its corrective retry');
  assert.deepEqual(correctedGroqPlan.aiProviders, ['groq']);
  assert.equal(correctedGroqPlan.week.length, 7);
  assert.equal(groqCorrectionCalls, 4,
    'an infeasible calorie draft must receive one Groq correction request, then the remaining two blocks must generate normally');
  assert.equal(groqCorrectionCloudflareCalls, 0,
    'a Groq-only Preview must keep Workers AI disabled during corrective plan generation');
} finally {
  globalThis.fetch = originalGroqRequiredFetch;
}

for(const planKey of ['Питание','PRO','Premium']){
 await assert.rejects(()=>generateAiPlan(profile,planKey,{}),
  /временно не смог подготовить полный персональный план/i,
  planKey+' must fail closed when no AI provider is available');
}
const proPlan = await generateAiPlan(profile, 'PRO', { AI: makeAi(14) });
assert.equal(proPlan.week.length, 14, 'PRO must contain 14 complete menu days');
assert.equal(proPlan.menuDays, 14);
assert.equal(proPlan.week[0].day, 'День 1');
assert.equal(proPlan.week[13].day, 'День 14');
assert.ok(proPlan.week.every(day =>
  day.nutrition.calories >= proPlan.calories * 0.90 &&
  day.nutrition.calories <= proPlan.calories * 1.10 &&
  [day.nutrition.protein,day.nutrition.fat,day.nutrition.carbs].every(value=>Number.isFinite(value)&&value>=0)
), 'each PRO day must meet the calorie band while macros remain calculated catalog values');
const expectedAverage = {
  calories: Math.round(proPlan.week.reduce((sum,day)=>sum+day.nutrition.calories,0)/proPlan.week.length),
  protein: Math.round(proPlan.week.reduce((sum,day)=>sum+day.nutrition.protein,0)/proPlan.week.length*10)/10,
  fat: Math.round(proPlan.week.reduce((sum,day)=>sum+day.nutrition.fat,0)/proPlan.week.length*10)/10,
  carbs: Math.round(proPlan.week.reduce((sum,day)=>sum+day.nutrition.carbs,0)/proPlan.week.length*10)/10
};
assert.deepEqual(proPlan.dailyAverage,expectedAverage,'daily averages must be calculated from the accepted AI days');
const breakfastReply = buildLocalPlanChatReply('Что у меня на завтрак в день 2?', proPlan);
assert.ok(breakfastReply.includes('День 2') && breakfastReply.includes('Состав:') && breakfastReply.includes('г'),
  'offline consultant must return the actual saved breakfast with ingredient weights');
const workoutReply = buildLocalPlanChatReply('Какая тренировка в день 3?', proPlan);
assert.ok(workoutReply.includes('День 3:') && workoutReply.includes('3×10'),
  'offline consultant must return the scheduled workout from the saved plan');
const macroReply = buildLocalPlanChatReply('Сколько у меня калорий и БЖУ?', proPlan);
assert.ok(macroReply.includes(proPlan.dailyAverage.calories + ' ккал') && macroReply.includes(proPlan.dailyAverage.protein + ' г'),
  'offline consultant must return the plan calorie and macro targets');
const shoppingReply = buildLocalPlanChatReply('Покажи список покупок', proPlan);
assert.ok(shoppingReply.includes('Список покупок') && shoppingReply.includes('Овсяные хлопья'),
  'offline consultant must return the server-calculated shopping list');
const localPremiumReview = buildLocalPremiumDiaryReview({
  trackingDays: 3, nutritionDays: 2, workoutDays: 1, weightChangeKg: -0.4
}, [{}, {}, {}]);
assert.equal(localPremiumReview.reviewMode, 'diary-summary');
assert.ok(localPremiumReview.summary.includes('не генеративный ИИ-разбор'));
assert.equal(localPremiumReview.observations.length, 4);
assert.equal(localPremiumReview.recommendations.length, 3);
assert.ok(proPlan.week.every(day => day.dinnerIngredients.find(item => item.foodId === 'olive_oil')?.grams === 20),
  'server normalization must enforce the 20g olive-oil portion ceiling');
assert.ok(proPlan.fat > 0 && proPlan.carbs > 0, 'daily fat and carbohydrate targets must be calculated');

const oversizedIngredientPlan = await generateAiPlan(profile, 'Питание', { AI: {
  async run(model, input) {
    const result = await makeAi(7).run(model, input);
    const parsed = JSON.parse(result.response);
    for (const day of parsed.week) {
      day.dinnerIngredients.find(item => item.foodId === 'olive_oil').grams = 25;
    }
    return { response: JSON.stringify(parsed) };
  }
} });
assert.ok(oversizedIngredientPlan.week.every(day => {
  const oil = day.dinnerIngredients.find(item => item.foodId === 'olive_oil');
  return oil?.grams === 20 &&
    day.nutrition.calories >= oversizedIngredientPlan.calories * 0.90 &&
    day.nutrition.calories <= oversizedIngredientPlan.calories * 1.10 &&
    [day.nutrition.protein,day.nutrition.fat,day.nutrition.carbs].every(value=>Number.isFinite(value)&&value>=0);
}), 'an ingredient above its product-specific ceiling must be clamped and the resulting day must still pass calorie and structural validation');
const invalidPortionFallback = await generateAiPlan(profile, 'Питание', { AI: {
  async run(model, input) {
    const result = await makeAi(7).run(model, input);
    const parsed = JSON.parse(result.response);
    parsed.week[0].breakfastIngredients[0].grams = 501;
    return { response: JSON.stringify(parsed) };
  }
} });
assert.equal(invalidPortionFallback.generationMode, 'ai',
  'an oversized but otherwise valid AI portion must be safely clamped instead of discarding the whole AI plan');
assert.equal(invalidPortionFallback.week[0].breakfastIngredients[0].grams, 150,
  'server normalization must clamp oversized oats to the product-specific maximum');
assert.ok(invalidPortionFallback.week.every(day =>
  ['breakfast','lunch','snack','dinner'].every(key =>
    day[key + 'Ingredients'].every(item => item.grams >= 5 && item.grams <= 500)
  )
));


const wrongModelTrainingFlagsPlan = await generateAiPlan(profile, 'PRO', { AI: {
  async run(model, input) {
    const result = await makeAi(14).run(model, input);
    const parsed = JSON.parse(result.response);
    parsed.week.forEach(day => { day.trainingDay = !day.trainingDay; });
    return { response: JSON.stringify(parsed) };
  }
} });
assert.deepEqual(
  wrongModelTrainingFlagsPlan.week.map(day => day.trainingDay),
  wrongModelTrainingFlagsPlan.week.map((_, index) => Math.floor(((index % 7) + 1) * profile.days / 7) > Math.floor((index % 7) * profile.days / 7)),
  'the server must override model-provided training flags and enforce the exact weekly schedule'
);
assert.ok(wrongModelTrainingFlagsPlan.week.every((day,index) =>
  day.trainingDay ? day.workout.includes('3×10') : day.workout.includes('Восстановление')
), 'scheduled training days must retain a full prescription and rest days must be normalized to recovery');

let activePlanCalls = 0;
let maxConcurrentPlanCalls = 0;
const concurrentPlan = await generateAiPlan(profile, 'PRO', { AI: {
  async run(model, input) {
    activePlanCalls++;
    maxConcurrentPlanCalls = Math.max(maxConcurrentPlanCalls, activePlanCalls);
    try {
      await new Promise(resolve => setTimeout(resolve, 5));
      return await makeAi(14).run(model, input);
    } finally {
      activePlanCalls--;
    }
  }
} });
assert.equal(concurrentPlan.week.length, 14, 'sequential chunk generation must still assemble every PRO day');
assert.equal(maxConcurrentPlanCalls, 1, 'AI plan blocks must never run concurrently');
function expectedShoppingLine(foodId) {
  const grams = proPlan.week.reduce((sum,day)=>sum+['breakfast','lunch','snack','dinner']
    .flatMap(key=>day[key+'Ingredients'])
    .filter(item=>item.foodId===foodId)
    .reduce((mealSum,item)=>mealSum+item.grams,0),0);
  const amount = grams >= 1000
    ? Number((grams/1000).toFixed(2)).toLocaleString('ru-RU') + ' кг'
    : grams + ' г';
  return FOOD_CATALOG[foodId].name + ' — ' + amount;
}
assert.ok(proPlan.shopping.includes(expectedShoppingLine('oats_dry')),
  'shopping list must aggregate accepted AI gram amounts for oats across all days');
assert.ok(proPlan.shopping.includes(expectedShoppingLine('milk_2pct')),
  'shopping list must aggregate accepted AI gram amounts for milk across all days');
assert.ok(!proPlan.shopping.includes('Продукты на весь период'));
assert.ok(proPlan.nutritionSource.includes('USDA FoodData Central'));
assert.ok(workerSource.includes('fdcId:173904'), 'oats reference must retain its USDA food record identifier');
assert.ok(workerSource.includes('for (let offset = 0; offset < totalDays; offset += generationBlockDays)') && workerSource.includes('const generationBlockDays = 3;') && workerSource.includes('const chunkDays = Math.min(generationBlockDays, totalDays - offset)') && !workerSource.includes('Promise.all([0, 2, 4, 6]'), 'long plans must be generated as sequential validated three-day blocks');
assert.ok(workerSource.includes('function rebalanceDayNutrition(day, targets, profile)') &&
 workerSource.includes('const originalFoodIds = items.map(item => item.foodId)') &&
 workerSource.includes('const minimumAllowed = targets.calories * 0.90') &&
 workerSource.includes('const maximumAllowed = targets.calories * 1.10') &&
 !workerSource.includes('for (let move = 0; move < 20; move++)'),
 'nutrition correction must adjust only gram amounts of selected foods within catalog bounds');
assert.ok(workerSource.includes('function aiFailureDiagnostic(error, maxLength = 1200)') &&
  workerSource.includes("forceTestMode && env.FITALPRO_PREVIEW_CI === '1' && plan.generationIssue") &&
  workerSource.includes("checkoutError.cause = new Error(clean(checkoutData.diagnostic, 1000))"),
  'nested AI provider errors must reach authenticated Preview diagnostics without leaking into public checkout responses');
assert.ok(workerSource.includes('const rejectionDiagnostics = [];') && workerSource.includes('rejectionDiagnostics.slice(-3)'), 'the next fallback model must receive concrete rejection reasons from the previous model');
assert.ok(workerSource.includes("const groqRequired = env.FITALPRO_REQUIRE_GROQ === '1';") &&
  workerSource.includes("const groqModels = preferredGroqModel === 'openai/gpt-oss-120b'") &&
  workerSource.includes("['groq:openai/gpt-oss-120b', 'groq:openai/gpt-oss-20b']") &&
  workerSource.includes("['groq:openai/gpt-oss-20b', 'groq:openai/gpt-oss-120b']") &&
  !workerSource.includes('qwen/qwen3.8-27b') &&
  !workerSource.includes('isQwenGroq') &&
  workerSource.includes("reasoning_effort: 'low'") &&
  workerSource.includes("include_reasoning: false") &&
  workerSource.includes("preferredGroqModel = generated.model.startsWith('groq:')") &&
  workerSource.includes("...(groqConfigured ? groqModels.filter(model => !providerState.groqDailyQuotaExhaustedModels.has(model.slice(5))) : [])") &&
  workerSource.includes("...(!groqRequired && env.AI ? [MODEL, '@cf/openai/gpt-oss-120b', '@cf/openai/gpt-oss-20b', '@cf/zai-org/glm-4.7-flash'] : [])") &&
  workerSource.includes('providerState.groqDailyQuotaExhaustedModels.add(model.slice(5))'),
  'plan generation must use only the approved GPT-OSS Groq models, enforce Groq-only Preview when required, and retain the bounded Cloudflare fallback chain elsewhere');
assert.ok(workerSource.includes('const originalFoodIds = items.map(item => item.foodId)') &&
  workerSource.includes('const correctedGrams = gramsAtScale((low + high) / 2)') &&
  !workerSource.includes('for (let move = 0; move < 20; move++)'),
  'nutrition correction must keep the selected food IDs unchanged and adjust only bounded gram amounts');
assert.ok(workerSource.includes('env.AI.run(model, inputs, { signal: controller.signal })') && workerSource.includes('env.AI.run(model, aiOptions, { rejectIfBusy: true })'),
  'plan generation may wait for capacity within its hard timeout while interactive chat remains fail-fast');
assert.ok(workerSource.includes('const AI_MODEL_TIMEOUT_MS = 45000;') && workerSource.includes('Promise.race([') && workerSource.includes('runAiInferenceWithTimeout(env, model'), 'each plan-model inference must have a hard timeout so a stalled model cannot block fallbacks');
assert.ok(workerSource.includes("...(env.AI ? ['@cf/zai-org/glm-4.7-flash', '@cf/meta/llama-3.1-8b-instruct-fast', MODEL] : [])"),
  'general chat must retain Cloudflare fallbacks when the binding is present');
assert.ok(workerSource.includes('max_tokens: 6200') && workerSource.includes('max_completion_tokens: 6200') && workerSource.includes('GPT_OSS_PLAN_TIMEOUT_MS = 60000') && workerSource.includes('AI_PLAN_FALLBACK_TIMEOUT_MS = 60000'), 'each Workers AI plan model must use its documented token-limit parameter and bounded timeout');
assert.ok(workerSource.includes("const isGptOss = model === '@cf/openai/gpt-oss-120b' || model === '@cf/openai/gpt-oss-20b'") && workerSource.includes('max_tokens: 6200') && workerSource.includes("reasoning_effort: 'low'"), 'both GPT-OSS fallbacks must use supported token limits and bounded reasoning');
assert.ok(!workerSource.includes('QWEN4_API_KEY') && !workerSource.includes('qwen4-max') &&
  !workerSource.includes('qwen/qwen3.8-27b'), 'Qwen integrations must remain absent from the plan-generation chain');
assert.ok(workerSource.includes('nutrition.calories >= targets.calories * 0.90') &&
 workerSource.includes('nutrition.calories <= targets.calories * 1.10') &&
 workerSource.includes('Отклонения белков, жиров и углеводов не являются причиной отказа') &&
 !workerSource.includes('Неизменные допуски сервера: калории ±7%'),
 'server validation and AI prompts must use per-day calorie tolerance only, with macros as calculated values');
assert.ok(workerSource.includes('function buildPlanResponseSchema(menuDays, allowedFoodIds = Object.keys(FOOD_CATALOG))') && workerSource.includes('minItems: menuDays') && workerSource.includes('maxItems: menuDays'), 'the reusable server schema helper must still describe exact plan length');
assert.ok(workerSource.includes("reasoning_effort: 'low'"), 'reasoning must be bounded to low for structured meal-plan generation');
assert.ok(workerSource.includes('const aiOptions = {') && workerSource.includes('env.AI.run(model, aiOptions, { rejectIfBusy: true })'), 'the AI chat fallback must also disable reasoning before inference');
assert.ok(workerSource.includes("https://api.groq.com/openai/v1/chat/completions") &&
  workerSource.includes("Authorization: 'Bearer ' + apiKey") &&
  workerSource.includes("type: 'json_schema'") &&
  workerSource.includes("name: 'fital_pro_plan'") &&
  workerSource.includes('strict: true') &&
  workerSource.includes('buildGroqStrictPlanSchema(menuDays, profile)') &&
  workerSource.includes('include_reasoning: false'),
  'optional Groq inference must use server-side API credentials, bounded output, and JSON-only structured generation');
assert.ok(workerSource.includes('week должен содержать РОВНО'), 'the model prompt must explicitly require the exact block length');
assert.equal(proPlan.week.slice(0, 7).filter(day => day.trainingDay).length, 3);
assert.equal(proPlan.week.slice(7, 14).filter(day => day.trainingDay).length, 3);

const premiumPlan = await generateAiPlan(profile, 'Premium', { AI: makeAi(30) });
assert.equal(premiumPlan.week.length, 30, 'Premium must contain 30 complete menu days');
assert.equal(premiumPlan.menuDays, 30);
assert.equal(premiumPlan.durationDays, 30);
assert.equal(premiumPlan.week[0].day, 'День 1');
assert.equal(premiumPlan.week[29].day, 'День 30');
assert.ok(premiumPlan.week.every(day =>
  ['breakfast', 'lunch', 'snack', 'dinner'].every(key =>
    day[key] && day[key + 'Recipe'].length >= 15 &&
    Array.isArray(day[key + 'Ingredients']) && day[key + 'Ingredients'].length >= 2
  ) &&
  Number.isFinite(day.nutrition?.calories) &&
  day.nutrition.calories >= premiumPlan.calories * 0.90 &&
  day.nutrition.calories <= premiumPlan.calories * 1.10 &&
  ['protein', 'fat', 'carbs'].every(key =>
    Number.isFinite(day.nutrition[key]) && day.nutrition[key] >= 0
  )
), 'all 30 Premium days must independently contain four complete meals and pass daily calorie and finite macro validation');
assert.deepEqual(premiumPlan.week.map(day => day.day),
  Array.from({ length: 30 }, (_, index) => 'День ' + (index + 1)),
  'Premium must not skip or duplicate any day across its ten three-day generation blocks');
const premiumTrainingCounts = Array.from({ length: 5 }, (_, index) =>
  premiumPlan.week.slice(index * 7, Math.min((index + 1) * 7, 30)).filter(day => day.trainingDay).length
);
assert.deepEqual(premiumTrainingCounts, [3, 3, 3, 3, 0], 'Premium training schedule must preserve the three-sessions-per-seven-days cadence without adding a workout to the final two-day partial week');
const nutritionPlan = await generateAiPlan(profile, 'Питание', { AI: makeAi(7) });
const timeoutFallbackModelsByBlock = new Map();
const timeoutRecoveredPlan = await generateAiPlan(profile, 'Питание', { AI: {
  async run(model, input, options) {
    const prompt = input?.messages?.[1]?.content || '';
    const startDay = Number(prompt.match(/БЛОК: дни ([0-9]+)–/)?.[1] || 0);
    const models = timeoutFallbackModelsByBlock.get(startDay) || [];
    models.push(model);
    timeoutFallbackModelsByBlock.set(startDay, models);
    assert.ok(options?.signal instanceof AbortSignal, 'each Workers AI plan call must receive an abort signal');
    if (startDay === 1 && model === '@cf/google/gemma-4-26b-a4b-it') {
      const error = new Error('simulated model timeout');
      error.name = 'TimeoutError';
      throw error;
    }
    return makeAi(7).run(model, input);
  }
} });
assert.equal(timeoutRecoveredPlan.week.length, 7, 'a timed-out first model must fall back to the next available model');
assert.equal(timeoutFallbackModelsByBlock.get(1)?.[1], '@cf/openai/gpt-oss-120b', 'a timed-out Gemma request must fall back to Cloudflare GPT-OSS 120B for the same block');
assert.equal(timeoutFallbackModelsByBlock.get(4)?.[0], '@cf/google/gemma-4-26b-a4b-it', 'the next three-day block must start with its own Gemma primary call');
let gemmaModelInput = null;
const gemmaPrimaryPlan = await generateAiPlan(profile, 'Питание', { AI: {
  async run(model, input, options) {
    assert.equal(model, '@cf/google/gemma-4-26b-a4b-it', 'Gemma 4 must be the first Cloudflare plan-generation model');
    assert.ok(options?.signal instanceof AbortSignal, 'Gemma inference must retain the hard timeout abort signal');
    gemmaModelInput = input;
    return makeAi(7).run(model, input);
  }
} });
assert.equal(gemmaPrimaryPlan.week.length, 7);
assert.equal(gemmaPrimaryPlan.generationMode, 'ai');
assert.deepEqual(gemmaPrimaryPlan.aiProviders, ['cloudflare-ai']);
assert.equal(gemmaModelInput.max_completion_tokens, 6200);
assert.deepEqual(gemmaModelInput.response_format, { type: 'json_object' }, 'Gemma should receive a JSON output hint and remain subject to strict server validation');
const gemmaPrompt = gemmaModelInput.messages[1].content;
assert.ok(gemmaPrompt.includes('\"name\":\"Клиент\"') && !gemmaPrompt.includes('Тестовый клиент'), 'all Cloudflare AI models must receive an anonymized client name');
assert.ok(gemmaPrompt.includes('белки') && gemmaPrompt.includes('жиры') && gemmaPrompt.includes('углеводы'),
  'the model must receive separate per-meal macro targets, not only a daily calorie target');
assert.ok(gemmaPrompt.includes('2–4 объекта') && gemmaPrompt.includes('\"olive_oil\":20'),
  'the model must leave safe correction capacity and receive product-specific portion limits');
let gptModelInput = null;
let gpt20ModelInput = null;
const gptRepairAttemptsByStart = new Map();
const gptRepairModelsByStart = new Map();
const gptRepairPlan = await generateAiPlan(profile, 'Питание', { AI: {
  async run(model, input) {
    if (model === '@cf/google/gemma-4-26b-a4b-it') throw new Error('Cloudflare primary models unavailable for repair regression');
    assert.ok(['@cf/openai/gpt-oss-120b', '@cf/openai/gpt-oss-20b'].includes(model));
    const prompt = input.messages[1].content;
    const startDay = Number(prompt.match(/БЛОК: дни ([0-9]+)[–-]/)?.[1] || 0);
    const attempts = (gptRepairAttemptsByStart.get(startDay) || 0) + 1;
    gptRepairAttemptsByStart.set(startDay, attempts);
    const models = gptRepairModelsByStart.get(startDay) || [];
    models.push(model);
    gptRepairModelsByStart.set(startDay, models);
    if (startDay === 1 && model === '@cf/openai/gpt-oss-120b') return makeAi(7, true).run(model, input);
    if (startDay === 1 && model === '@cf/openai/gpt-oss-20b') {
      gpt20ModelInput = input;
      assert.ok(input.messages.at(-1).content.includes('week-length-'));
    }
    if (model === '@cf/openai/gpt-oss-120b') gptModelInput = input;
    return makeAi(7).run(model, input);
  }
} });
assert.equal(gptRepairPlan.week.length, 7);
assert.equal(gptRepairAttemptsByStart.get(1), 2, 'GPT-OSS 20B must receive the corrective rejection reasons after GPT-OSS 120B fails validation');
assert.deepEqual(gptRepairModelsByStart.get(1), ['@cf/openai/gpt-oss-120b', '@cf/openai/gpt-oss-20b']);
assert.equal(gptRepairAttemptsByStart.get(4), 1, 'valid GPT-OSS 120B output must not trigger an unnecessary retry');
assert.equal(gpt20ModelInput.max_tokens, 6200);
assert.equal(gpt20ModelInput.reasoning_effort, 'low');

const gptFallbackPlan = await generateAiPlan(profile, 'Питание', { AI: {
  async run(model, input) {
    if (model === '@cf/google/gemma-4-26b-a4b-it') throw new Error('Gemma intentionally unavailable in this test');
    assert.equal(model, '@cf/openai/gpt-oss-120b', 'GPT-OSS must follow Gemma when it is unavailable');
    gptModelInput = input;
    return makeAi(7).run(model, input);
  }
} });
assert.equal(gptFallbackPlan.week.length, 7, 'GPT-OSS fallback must produce a complete server-validated seven-day plan');
assert.equal(gptModelInput.max_tokens, 6200);
assert.equal(gptModelInput.reasoning_effort, 'low');
assert.equal(gptModelInput.response_format, undefined, 'do not send undocumented JSON Mode to GPT-OSS; validate its JSON response server-side');
assert.ok(workerSource.includes('не добавляй и не заменяй продукты ради достижения калорийности') &&
 workerSource.includes('Белки, жиры и углеводы — расчётные показатели'),
 'AI correction must preserve selected foods for calorie-only adjustments and treat macros as calculated values');
assert.ok(workerSource.includes('верни полный JSON') || workerSource.includes('Верни полный JSON'), 'correction prompt must request the complete plan JSON');
const diagnosticSource = JSON.parse((await makeAi(7).run()).response);
diagnosticSource.week[0].snackRecipe = 'Смешать.';
const multiFailureReason = diagnosePlanWeekFailure(diagnosticSource, profile, 'Питание', 7, {
  calories: 2600, protein: 150, fat: 100, carbs: 350
});
assert.ok(multiFailureReason.includes('day-1-snack-recipe-short-or-missing'), 'diagnostics must preserve recipe-length errors');
assert.ok(multiFailureReason.includes('day-1-calories=') && !multiFailureReason.includes('day-1-carbs='), 'diagnostics must report calorie deviations but never reject macro-only deviations');

const correctedPortionPlan = await generateAiPlan(profile, 'PRO', { AI: makeAi(14, false, false, false, false, 0.7) });
const underPortionRetryAI=makeRetryAi(7,0.4,0.7);
let lowEnergyCorrectionPrompt='';
const lowEnergyFallbackPlan=await generateAiPlan(profile,'Питание',{AI:{
 async run(model,input){
  if(model==='@cf/google/gemma-4-26b-a4b-it')return makeAi(7,false,false,false,false,0.4).run(model,input);
  if(model==='@cf/openai/gpt-oss-120b'){lowEnergyCorrectionPrompt=input.messages.at(-1).content;return makeAi(7).run(model,input);}
  throw new Error('unexpected model after calorie correction');
 }
}});
assert.equal(lowEnergyFallbackPlan.week.length,7);
assert.equal(lowEnergyCorrectionPrompt,'','recoverable under-portioned meals must be corrected locally without another model request');
const severelyUnderPortionedPlan=await generateAiPlan(profile,'Питание',{AI:underPortionRetryAI});
assert.equal(underPortionRetryAI.calls,3,'each recoverable three-day block must be corrected locally without repeated AI calls');
const severelyOverProteinPlan=await generateAiPlan(profile,'Питание',{AI:makeAi(7,false,false,false,false,1.4)});
const mixedMacroRecovery=await generateAiPlan(profile,'Питание',{AI:{
 async run(model,input){
  const response=await makeAi(7).run(model,input),parsed=JSON.parse(response.response);
  for(const day of parsed.week){
   const setPortion=(meal,foodId,grams)=>{const item=day[meal+'Ingredients'].find(value=>value.foodId===foodId);if(item)item.grams=grams;};
   setPortion('breakfast','oats_dry',15);setPortion('breakfast','banana',20);
   setPortion('lunch','chicken_raw',220);setPortion('lunch','rice_dry',15);
   setPortion('snack','greek_yogurt',250);setPortion('snack','apple',20);setPortion('snack','almonds',30);
   setPortion('dinner','salmon_raw',180);setPortion('dinner','potato_raw',20);
  }
  return {response:JSON.stringify(parsed)};
 }
}});
assert.equal(mixedMacroRecovery.week.length,7);
assert.ok(mixedMacroRecovery.week.every(day=>
 [day.nutrition.calories,day.nutrition.protein,day.nutrition.fat,day.nutrition.carbs].every(value=>Number.isFinite(value)&&value>=0) &&
 day.nutrition.calories>=mixedMacroRecovery.calories*0.90&&day.nutrition.calories<=mixedMacroRecovery.calories*1.10),
 'macro deviations must not reject a day when calories and food rules pass');
for(const [label,plan] of [['under-portioned',severelyUnderPortionedPlan],['over-portioned',severelyOverProteinPlan]]){
 assert.equal(plan.week.length,7);
 assert.ok(plan.week.every(day=>nutritionWithinTargetsForTest(day.nutrition,{calories:plan.calories})));
}
assert.equal(correctedPortionPlan.week.length,14);
assert.ok(correctedPortionPlan.week.every(day=>nutritionWithinTargetsForTest(day.nutrition,{calories:correctedPortionPlan.calories})));


// The production validator must reject a meal with only one ingredient even if its calories fit.
await assert.rejects(
  () => generateAiPlan(profile, 'Питание', { AI: { async run(model, input) {
    const response = await makeAi(7).run(model, input);
    const parsed = JSON.parse(response.response);
    parsed.week[0].breakfastIngredients = [parsed.week[0].breakfastIngredients[0]];
    return { response: JSON.stringify(parsed) };
  } } }),
  /временно не смог подготовить полный персональный план/i,
  'a meal with one ingredient must be rejected by server-side validation'
);

for(const [label,createPlan] of [
 ['missing recipe',()=>generateAiPlan(profile,'Питание',{AI:{async run(model,input){const response=await makeAi(7).run(model,input),parsed=JSON.parse(response.response);parsed.week[0].breakfastRecipe='';return {response:JSON.stringify(parsed)};}}})],
 ['wrong 14-day length',()=>generateAiPlan(profile,'PRO',{AI:makeAi(14,true)})],
 ['wrong 30-day length',()=>generateAiPlan(profile,'Premium',{AI:makeAi(30,true)})],
 ['missing ingredients',()=>generateAiPlan(profile,'PRO',{AI:makeAi(14,false,true,false)})],
 ['missing workout',()=>generateAiPlan(profile,'PRO',{AI:makeAi(14,false,false,true)})]
]){
 await assert.rejects(createPlan(),/временно не смог подготовить полный персональный план/i,
  label+' must not be replaced by a catalog-generated plan');
}
await assert.rejects(()=>generateAiPlan(profile,'PRO',{AI:makeAi(14,false,false,false,true)}),
 /временно не смог подготовить полный персональный план/i,
 'an infeasible severely under-portioned plan must fail closed');

let nutritionRetryCalls=0;
const nutritionRetryModelsByBlock=new Map();
const nutritionRetryAi={async run(model,input){
 nutritionRetryCalls++;
 const prompt=input?.messages?.map(message=>message?.content||'').join('\n')||'';
 const startDay=Number(prompt.match(/БЛОК: дни ([0-9]+)[–-]/)?.[1]||0);
 const models=nutritionRetryModelsByBlock.get(startDay)||[];models.push(model);nutritionRetryModelsByBlock.set(startDay,models);
 return (startDay===1&&models.length<=2?makeAi(7,false,false,false,true):makeAi(7)).run(model,input);
}};
const recoveredNutritionPlan=await generateAiPlan(profile,'Питание',{AI:nutritionRetryAi});
assert.equal(recoveredNutritionPlan.week.length,7);
assert.equal(nutritionRetryCalls,5);
assert.deepEqual(nutritionRetryModelsByBlock.get(1),['@cf/google/gemma-4-26b-a4b-it','@cf/openai/gpt-oss-120b','@cf/openai/gpt-oss-20b']);
assert.deepEqual(nutritionRetryModelsByBlock.get(4),['@cf/google/gemma-4-26b-a4b-it']);
assert.deepEqual(nutritionRetryModelsByBlock.get(7),['@cf/google/gemma-4-26b-a4b-it']);
assert.ok(workerSource.includes('const generationBlockDays = 3;'));

// A minor model rounding error on a single ingredient is normalized to the
// documented 5 g minimum; the final plan still passes calorie validation.
const minimumPortionPlan=await generateAiPlan(profile,'Питание',{AI:{async run(model,input){
 const response=await makeAi(7).run(model,input),parsed=JSON.parse(response.response);
 for(const day of parsed.week)day.dinnerIngredients[4].grams=3;
 return {response:JSON.stringify(parsed)};
}}});
assert.ok(minimumPortionPlan.week.every(day=>day.dinnerIngredients[4].grams>=5),
 'AI portions below 5 g must be normalized to the safe 5 g minimum rather than rejecting an otherwise valid meal');

// GLM-4.7 Flash is the final existing-Cloudflare fallback after the current
// Gemma and GPT-OSS routes fail; its output remains subject to full validation.
const glmFallbackModels=[];
const glmFallbackPlan=await generateAiPlan(profile,'Питание',{AI:{async run(model,input){
 glmFallbackModels.push(model);
 if(model!=='@cf/zai-org/glm-4.7-flash')throw new Error('simulated earlier Cloudflare model failure');
 assert.deepEqual(input.response_format,{type:'json_object'});
 assert.deepEqual(input.chat_template_kwargs,{enable_thinking:false});
 return makeAi(7).run(model,input);
}}});
assert.equal(glmFallbackPlan.week.length,7);
assert.deepEqual(glmFallbackModels.slice(0,4),[
 '@cf/google/gemma-4-26b-a4b-it',
 '@cf/openai/gpt-oss-120b',
 '@cf/openai/gpt-oss-20b',
 '@cf/zai-org/glm-4.7-flash'
]);

// Premium must complete all 30 days. Once both Groq models report a daily
// token quota, later three-day blocks must not retry the exhausted Groq quota.
const originalPremiumQuotaFetch=globalThis.fetch;
let premiumGroqQuotaCalls=0;
const premiumCloudflareModels=[];
try{
 globalThis.fetch=async(_url,init)=>{
  premiumGroqQuotaCalls++;
  const payload=JSON.parse(init.body);
  return new Response(JSON.stringify({error:{message:'Rate limit reached for model '+payload.model+' on tokens per day (TPD): Limit 200000, Used 200000'}}),{
   status:429,headers:{'content-type':'application/json'}
  });
 };
 const premiumQuotaPlan=await generateAiPlan(profile,'Premium',{
  GROQ_API_KEY:'test-groq-key',
  AI:{async run(model,input){
   premiumCloudflareModels.push(model);
   assert.equal(model,'@cf/google/gemma-4-26b-a4b-it');
   return makeAi(30).run(model,input);
  }}
 });
 assert.equal(premiumQuotaPlan.week.length,30);
 assert.equal(premiumQuotaPlan.durationDays,30);
 assert.equal(premiumGroqQuotaCalls,2,'daily Groq quota should be detected once per model, not retried for every 3-day block');
 assert.equal(premiumCloudflareModels.length,10,'all ten Premium day-blocks must be generated and validated');
}finally{
 globalThis.fetch=originalPremiumQuotaFetch;
}

// Quotas are model-specific: if 120B is exhausted but 20B remains available,
// keep using 20B for every remaining Premium block instead of disabling Groq.
const originalSingleGroqQuotaFetch=globalThis.fetch;
let exhausted120bCalls=0;
let available20bCalls=0;
try{
 globalThis.fetch=async(_url,init)=>{
  const payload=JSON.parse(init.body);
  if(payload.model==='openai/gpt-oss-120b'){
   exhausted120bCalls++;
   return new Response(JSON.stringify({error:{message:'Rate limit reached for tokens per day (TPD)'}}),{
    status:429,headers:{'content-type':'application/json'}
   });
  }
  available20bCalls++;
  const fixture=await makeAi(30).run(payload.model,{messages:payload.messages});
  return new Response(JSON.stringify({choices:[{message:{content:fixture.response},finish_reason:'stop'}]}),{
   status:200,headers:{'content-type':'application/json'}
  });
 };
 const premiumGroqFallback=await generateAiPlan(profile,'Premium',{
  GROQ_API_KEY:'test-groq-key',
  AI:{async run(){throw new Error('Cloudflare must not be called while Groq 20B is available');}}
 });
 assert.equal(premiumGroqFallback.week.length,30);
 assert.deepEqual(premiumGroqFallback.aiProviders,['groq']);
 assert.equal(exhausted120bCalls,1,'the exhausted 120B endpoint must not be retried on later blocks');
 assert.equal(available20bCalls,10,'the available 20B endpoint must generate all ten Premium blocks');
}finally{
 globalThis.fetch=originalSingleGroqQuotaFetch;
}

const modelCalls = [];
const fallbackText = await runAiTextWithFallback({
  AI: {
    async run(model) {
      modelCalls.push(model);
      if (modelCalls.length === 1) throw new Error('primary model unavailable');
      return { response: 'Ответ резервной модели' };
    }
  }
}, { messages: [] }, 'test');
assert.equal(fallbackText, 'Ответ резервной модели');
assert.equal(modelCalls.length, 2, 'fallback model must be tried after the primary model fails');

const invalidOutputCalls = [];
const validatedFallback = await runAiTextWithFallback({
  AI: {
    async run(model) {
      invalidOutputCalls.push(model);
      return { response: invalidOutputCalls.length === 1 ? 'not valid JSON' : '{"summary":"Готово","recommendations":["Шаг 1","Шаг 2"]}' };
    }
  }
}, { messages: [] }, 'test-validation', text => {
  try {
    const parsed = JSON.parse(text);
    return !!parsed.summary && Array.isArray(parsed.recommendations) && parsed.recommendations.length >= 2;
  } catch {
    return false;
  }
});
assert.ok(validatedFallback.includes('Готово'));
assert.equal(invalidOutputCalls.length, 2, 'fallback must also run when the primary model returns malformed output');

console.log('PASS: 7/14/30-day AI plans, per-day calorie tolerance, calculated macros, shopping aggregation and workout prescriptions');
assert.ok(workerSource.includes("'Premium': { amount: '3990.00', label: 'Fital Pro Premium — меню и тренировки, 30 дней', days: 30, menuDays: 30 }"), 'Premium must configure 30 menu days');
assert.ok(workerSource.includes('profile.age < 18'), 'adult nutrition formula must not be used for minors');
assert.ok(htmlSource.includes('min="18"'), 'both questionnaire forms must require adult age');
assert.ok(appSource.includes('Состав, вес до приготовления'), 'the plan must show the ingredients used for nutrition calculations');
assert.ok(appSource.includes('Эта программа создана до обновления расчёта по ингредиентам'), 'legacy customer plans must remain readable without false zero nutrition totals');
assert.ok(appSource.includes('Меню и тренировки на 30 дней, доступ на 30 дней'), 'Premium checkout description must promise 30 days');
assert.ok(htmlSource.includes('тренировочная программа на все 30 дней'), 'Premium tariff must advertise a 30-day training program');

const checkoutStart = workerSource.indexOf('async function checkout(');
const checkoutEnd = workerSource.indexOf('\nasync function ', checkoutStart + 1);
const checkoutSource = workerSource.slice(checkoutStart, checkoutEnd);
const previewStart = checkoutSource.indexOf('    preview: {');
const previewEnd = checkoutSource.indexOf('\n    }\n  });', previewStart);
const previewSource = checkoutSource.slice(previewStart, previewEnd);
assert.ok(previewSource.includes('firstDay: plan.week[0]'), 'checkout may show only the first-day teaser');
assert.ok(!previewSource.includes('fullPlan'), 'checkout response must not expose the complete paid plan');
assert.ok(checkoutSource.includes('JSON.stringify(plan)'), 'the complete generated plan must remain saved server-side for post-payment activation');
assert.ok(!appSource.includes('checkoutData.preview.fullPlan'), 'the browser must not render the full paid plan before payment');
assert.ok(!htmlSource.includes('id="previewFullPlan"'), 'the pre-payment page must not contain a full-plan container');
assert.ok(htmlSource.includes('после подтверждения оплаты'), 'the page must explain that full access follows payment');


const diagnosticDenied = await aiPlanDiagnostic(new Request('https://fitalpro.test/api/ai-diagnostic', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Fital-Test-Key': 'wrong-key' },
  body: JSON.stringify({ plan: 'Питание', profile })
}), { ROBOKASSA_TEST_ACCESS_KEY: 'test-secret', AI: makeAi(7) });
assert.equal(diagnosticDenied.status, 404, 'diagnostic route must reject an incorrect test key');

const noDatabaseAccess = new Proxy({}, {
  get() { throw new Error('diagnostic route must not access D1'); }
});
const diagnosticResponse = await aiPlanDiagnostic(new Request('https://fitalpro.test/api/ai-diagnostic', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Fital-Test-Key': 'test-secret' },
  body: JSON.stringify({ plan: 'Питание', profile })
}), {
  ROBOKASSA_TEST_ACCESS_KEY: 'test-secret',
  AI: makeAi(7),
  DB: noDatabaseAccess
});
assert.equal(diagnosticResponse.status, 200, 'authorized diagnostic must generate and validate a plan');
const diagnosticData = await diagnosticResponse.json();
assert.equal(diagnosticData.ok, true);
assert.equal(diagnosticData.days.length, 7);
assert.ok(diagnosticData.days[0].meals.breakfast.ingredients.length >= 2);
assert.ok(diagnosticData.days[0].meals.breakfast.recipe.length >= 15, 'diagnostic must expose practical cooking instructions');
assert.ok(diagnosticData.days[0].calculatedNutrition.calories > 0);
assert.ok(diagnosticData.days[0].calculatedNutrition.protein > 0);
assert.ok(diagnosticData.days[0].calculatedNutrition.fat > 0);
assert.ok(diagnosticData.days[0].calculatedNutrition.carbs > 0);
assert.ok(diagnosticData.targets.fat > 0 && diagnosticData.targets.carbs > 0);
assert.ok(diagnosticData.shopping.length > 0);
assert.equal(diagnosticData.days[0].trainingDay, false, 'diagnostic must expose the server-scheduled rest-day flag');
assert.ok(typeof diagnosticData.days[0].workout === 'string' && diagnosticData.days[0].workout.length > 0,
  'diagnostic must expose the workout or recovery instructions for each day');
const proDiagnosticResponse = await aiPlanDiagnostic(new Request('https://fitalpro.test/api/ai-diagnostic', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Fital-Test-Key': 'test-secret' },
  body: JSON.stringify({ plan: 'PRO', profile })
}), {
  ROBOKASSA_TEST_ACCESS_KEY: 'test-secret',
  AI: makeAi(14),
  DB: noDatabaseAccess
});
assert.equal(proDiagnosticResponse.status, 200, '14-day PRO diagnostic must complete without accessing D1');
const proDiagnosticData = await proDiagnosticResponse.json();
assert.equal(proDiagnosticData.plan, 'PRO');
assert.equal(proDiagnosticData.durationDays, 14);
assert.equal(proDiagnosticData.days.length, 14);
assert.deepEqual(proDiagnosticData.days.map(day => day.day),
  Array.from({ length: 14 }, (_, index) => 'День ' + (index + 1)),
  '14-day diagnostic must return every day in the correct order');
assert.deepEqual(proDiagnosticData.days.map(day => day.trainingDay),
  Array.from({ length: 14 }, (_, index) =>
    Math.floor(((index % 7) + 1) * profile.days / 7) > Math.floor((index % 7) * profile.days / 7)),
  '14-day diagnostic must preserve exactly three scheduled workouts in each full week');
assert.equal(proDiagnosticData.days.filter(day => day.trainingDay).length, 6);
assert.ok(proDiagnosticData.days.every(day => typeof day.workout === 'string' && day.workout.length >= 15),
  'every 14-day entry must include a workout prescription or recovery instructions');
assert.ok(proDiagnosticData.days.every(day =>
  Object.keys(day.meals || {}).length === 4 &&
  Object.values(day.meals).every(meal =>
    meal.title && meal.recipe.length >= 15 && Array.isArray(meal.ingredients) && meal.ingredients.length >= 2
  ) &&
  day.calculatedNutrition.calories >= proDiagnosticData.targets.calories * 0.90 &&
  day.calculatedNutrition.calories <= proDiagnosticData.targets.calories * 1.10
), 'every 14-day entry must contain four complete meals and pass daily calorie validation');
assert.ok(workerSource.includes("url.pathname === '/api/ai-diagnostic'"), 'diagnostic route must be registered');
assert.ok(workerSource.includes('async function aiPlanDiagnostic(request, env)'), 'diagnostic route handler must exist');
assert.ok(workerSource.includes('diagnostic path deliberately does not call checkout, rateLimit, or any D1 write'));
assert.ok(workerSource.includes('aiPlanDiagnostic, aiDataFlowDiagnostic, generateAiPlan'), 'diagnostic handler must be testable');
assert.ok((await readFile(new URL('../public/ai-diagnostic.html', import.meta.url), 'utf8')).includes('noindex,nofollow,noarchive'));

console.log('PASS: protected no-write AI diagnostic endpoint');

const flowDiagnosticDenied = await aiDataFlowDiagnostic(new Request('https://fitalpro.test/api/ai-data-flow-diagnostic', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Fital-Test-Key': 'wrong-key' },
  body: JSON.stringify({ plan: 'Питание' })
}), {
  ROBOKASSA_TEST_ACCESS_KEY: 'test-secret',
  AI: makeAi(7),
  DB: noDatabaseAccess
});
assert.equal(flowDiagnosticDenied.status, 404, 'D1 and cabinet integration diagnostic must reject an incorrect test key');
assert.ok(workerSource.includes("url.pathname === '/api/ai-data-flow-diagnostic'"), 'protected D1 and cabinet diagnostic route must be registered');
assert.ok(workerSource.includes('Commit payment, subscription, profile, full plan and paid status together.'), 'integration diagnostic must persist the generated plan and profile in the atomic payment activation');
assert.ok(workerSource.includes('verifyGitHubActionsOidc(request, env, diagnosticMode)'), 'live diagnostic must authenticate GitHub Actions using production or restricted Preview OIDC');
assert.ok(workerSource.includes("claims.aud !== 'fitalpro-ai-data-flow'"), 'OIDC authorization must restrict the token audience');
assert.ok(workerSource.includes("claims.ref === 'refs/heads/main'") &&
  workerSource.includes("['push', 'workflow_dispatch'].includes(claims.event_name)") &&
  workerSource.includes("(mode === 'production' ? !productionWorkflow : !previewWorkflow)"),
  'production OIDC must remain restricted to main-branch push or manual workflow dispatch');
assert.ok(workerSource.includes("env?.FITALPRO_PREVIEW_CI === '1'") && workerSource.includes("claims.ref === 'refs/pull/53/merge'"), 'Preview OIDC must require the explicit preview flag and exact PR merge ref');
assert.ok(workerSource.includes("claims.head_ref === 'design/tilda-inspired-bold-redesign'") && workerSource.includes("claims.base_ref === 'main'"), 'Preview OIDC must restrict the exact source and target branches');
assert.ok(workerSource.includes("pull-request-checks.yml@refs/pull/53/merge"), 'Preview OIDC must restrict the dedicated PR workflow');
assert.ok(workerSource.includes("const diagnosticMode = env?.FITALPRO_PREVIEW_CI === '1' ? 'preview' : 'production';") &&
  workerSource.includes("verifyGitHubActionsOidc(request, env, diagnosticMode)"),
  'AI and D1 diagnostics must select production or restricted Preview OIDC from the Worker environment');
assert.ok(workerSource.includes('vladimirdemenin5-pixel@324070911/fital-pro@1354815283:ref:refs/heads/main'), 'OIDC authorization must accept the repository immutable subject claim');
assert.ok(workerSource.includes('env.FITALPRO_CI_TEST_KEY || env.ROBOKASSA_TEST_ACCESS_KEY'), 'integration diagnostic must support the temporary CI-only key without changing the Robokassa test key');
assert.ok(workerSource.includes("personalizedPlan(new Request('https://fitalpro.internal/api/plan'"), 'integration diagnostic must read the saved plan through the personal-cabinet API');
assert.ok(workerSource.includes("profileApi(new Request('https://fitalpro.internal/api/profile'"), 'integration diagnostic must read the saved profile through the personal-cabinet API');
assert.ok(workerSource.includes("DELETE FROM weekly_plans WHERE access_token=?"), 'temporary diagnostic plans must be cleaned up after verification');
assert.ok(workerSource.includes("DELETE FROM subscriptions WHERE access_token=?"), 'temporary diagnostic access must be cleaned up after verification');
console.log('PASS: protected AI → D1 → personal-cabinet diagnostic and cleanup');

