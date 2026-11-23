import assert from 'node:assert/strict';
import { generateAiPlan, runAiTextWithFallback, runAiInferenceWithTimeout, aiPlanDiagnostic, aiDataFlowDiagnostic, FOOD_CATALOG } from '../_worker.js';
import { readFile } from 'node:fs/promises';

const workerSource = await readFile(new URL('../_worker.js', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const htmlSource = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
assert.ok(Object.entries(FOOD_CATALOG).length >= 30, 'food reference catalog must remain populated');
assert.ok(Object.entries(FOOD_CATALOG).every(([id, food]) => Number.isFinite(food.kcal) && Number.isFinite(food.protein) && Number.isFinite(food.fat) && Number.isFinite(food.carbs)), 'every food must define calories, protein, fat and carbohydrates');

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
      const prompt = input?.messages?.[1]?.content || '';
      const block = prompt.match(/БЛОК: дни (\d+)–(\d+) из (\d+)/);
      const requestedDays = block ? Number(block[2]) - Number(block[1]) + 1 : menuDays;
      const count = wrongLength ? 3 : requestedDays;
      const week = Array.from({ length: count }, (_, index) => {
        const dayInWeek = index % 7;
        const trainingDay = dayInWeek === 0 || dayInWeek === 2 || dayInWeek === 4;
        const tiny = invalidNutrition;
        const portion = grams => Math.max(5, Math.round(grams * portionScale));
        return {
          day: 'День ' + (index + 1),
          trainingDay,
          breakfast: 'Овсяная каша с бананом',
          breakfastRecipe: 'Свари хлопья на молоке до мягкости и добавь нарезанный банан.',
          breakfastIngredients: invalidMeal ? [] : (tiny ? [['oats_dry', 5]] : [['oats_dry', portion(80)], ['milk_2pct', portion(200)], ['banana', portion(120)]]),
          lunch: 'Курица с рисом и брокколи',
          lunchRecipe: 'Отвари рис, запеки курицу и приготовь брокколи на пару.',
          lunchIngredients: tiny ? [['chicken_raw', 5]] : [['chicken_raw', portion(100)], ['rice_dry', portion(85)], ['broccoli', portion(100)]],
          snack: 'Йогурт с яблоком и миндалём',
          snackRecipe: 'Нарежь яблоко и подай с йогуртом и миндалём.',
          snackIngredients: tiny ? [['greek_yogurt', 5]] : [['greek_yogurt', portion(150)], ['apple', portion(150)], ['almonds', portion(15)]],
          dinner: 'Лосось с картофелем и овощами',
          dinnerRecipe: 'Запеки лосось с картофелем, подай с овощами.',
          dinnerIngredients: tiny ? [['salmon_raw', 5]] : [['salmon_raw', portion(100)], ['potato_raw', portion(200)], ['olive_oil', portion(28)], ['tomato', portion(100)], ['avocado', portion(50)]],
          workout: trainingDay ? (invalidWorkout ? 'Разминка, приседания и тяга' : 'Разминка, приседания 3×10, тяга 3×10, заминка') : 'Прогулка и восстановление'
        };
      });
      return { response: JSON.stringify({ intro: 'План создан по тестовой анкете.', week, tips: ['Пейте воду по жажде.'] }) };
    }
  };
}

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

const proPlan = await generateAiPlan(profile, 'PRO', { AI: makeAi(14) });
assert.equal(proPlan.week.length, 14, 'PRO must contain 14 complete menu days');
assert.equal(proPlan.menuDays, 14);
assert.equal(proPlan.week[0].day, 'День 1');
assert.equal(proPlan.week[13].day, 'День 14');
assert.deepEqual(proPlan.week[0].nutrition, { calories: 1943, protein: 98.1, fat: 71, carbs: 237.1 });
assert.equal(proPlan.dailyAverage.calories, 1943);
assert.equal(proPlan.dailyAverage.protein, 98.1);
assert.equal(proPlan.dailyAverage.fat, 71);
assert.equal(proPlan.dailyAverage.carbs, 237.1);
assert.ok(proPlan.fat > 0 && proPlan.carbs > 0, 'daily fat and carbohydrate targets must be calculated');
assert.ok(proPlan.shopping.includes('Овсяные хлопья, сухие — 1,12 кг'));
assert.ok(proPlan.shopping.includes('Молоко 2% — 2,8 кг'));
assert.ok(!proPlan.shopping.includes('Продукты на весь период'));
assert.ok(proPlan.nutritionSource.includes('USDA FoodData Central'));
assert.ok(workerSource.includes('fdcId:173904'), 'oats reference must retain its USDA food record identifier');
assert.ok(workerSource.includes('for (let offset = 0; offset < totalDays; offset += 7)'), 'long plans must be generated and validated in seven-day blocks');
assert.ok(workerSource.includes('const stepSizes = [20, 5, 1];') && workerSource.includes('for (let iteration = 0; iteration < 80; iteration++)') && workerSource.includes('for (const direction of [-1, 1])'), 'portion correction must make bounded large-to-small adjustments without relaxing nutrition ranges');
assert.ok(workerSource.includes('const validationDiagnostics = [];') && workerSource.includes('validationDiagnostics.slice(-3)'), 'AI correction retry must retain actual validation failures instead of timeout noise');
assert.ok(workerSource.includes("const models = ['@cf/zai-org/glm-4.7-flash', '@cf/meta/llama-3.1-8b-instruct-fast', MODEL];"), 'plan generation must use GLM Flash, fast Llama, then Gemma fallback');
assert.ok(workerSource.includes('rejectIfBusy: true'), 'Workers AI must skip a busy model queue and fall back instead of waiting until the request times out');
assert.ok(workerSource.includes('const AI_MODEL_TIMEOUT_MS = 45000;') && workerSource.includes('Promise.race([') && workerSource.includes('runAiInferenceWithTimeout(env, model'), 'each plan-model inference must have a hard timeout so a stalled model cannot block fallbacks');
assert.equal((workerSource.match(/const models = \['@cf\/zai-org\/glm-4\.7-flash', '@cf\/meta\/llama-3\.1-8b-instruct-fast', MODEL\];/g) || []).length, 2, 'both chat and plan generation must try GLM Flash, fast Llama and Gemma in order');
assert.ok(workerSource.includes('max_completion_tokens: 6500') && workerSource.includes('max_tokens: 6500'), 'GLM/Gemma and fast Llama must use their respective documented output-token parameters');
assert.ok(workerSource.includes("type: 'json_schema'") && workerSource.includes('minItems: menuDays') && workerSource.includes('maxItems: menuDays'), 'fast Llama JSON schema must constrain the week array to the requested number of days');
assert.ok(workerSource.includes('reasoning_effort: null'), 'reasoning must be explicitly disabled for deterministic structured meal-plan generation');
assert.ok(workerSource.includes('const aiOptions = {') && workerSource.includes('env.AI.run(model, aiOptions, { rejectIfBusy: true })'), 'the AI chat fallback must also disable reasoning before inference');
assert.ok(workerSource.includes('week должен содержать РОВНО'), 'the model prompt must explicitly require the exact block length');
assert.equal(proPlan.week.slice(0, 7).filter(day => day.trainingDay).length, 3);
assert.equal(proPlan.week.slice(7, 14).filter(day => day.trainingDay).length, 3);

const premiumPlan = await generateAiPlan(profile, 'Premium', { AI: makeAi(30) });
assert.equal(premiumPlan.week.length, 30, 'Premium must contain 30 complete menu days');
assert.equal(premiumPlan.menuDays, 30);
assert.equal(premiumPlan.durationDays, 30);
assert.equal(premiumPlan.week[0].day, 'День 1');
assert.equal(premiumPlan.week[29].day, 'День 30');
const premiumTrainingCounts = Array.from({ length: 5 }, (_, index) =>
  premiumPlan.week.slice(index * 7, Math.min((index + 1) * 7, 30)).filter(day => day.trainingDay).length
);
assert.deepEqual(premiumTrainingCounts, [3, 3, 3, 3, 1], 'Premium training schedule must cover all 30 days, including the final two-day block');
const nutritionPlan = await generateAiPlan(profile, 'Питание', { AI: makeAi(7) });
const timeoutFallbackModels = [];
const timeoutRecoveredPlan = await generateAiPlan(profile, 'Питание', { AI: {
  async run(model, input, options) {
    timeoutFallbackModels.push(model);
    assert.ok(options?.signal instanceof AbortSignal, 'each Workers AI plan call must receive an abort signal');
    if (timeoutFallbackModels.length === 1) {
      const error = new Error('simulated model timeout');
      error.name = 'TimeoutError';
      throw error;
    }
    return makeAi(7).run(model, input);
  }
} });
assert.equal(timeoutRecoveredPlan.week.length, 7, 'a timed-out first model must fall back to the next available model');
assert.equal(timeoutFallbackModels[1], '@cf/meta/llama-3.1-8b-instruct-fast', 'the catalog-listed fast Llama model must be attempted after the first model times out');
let fastLlamaModelInput = null;
const schemaConstrainedPlan = await generateAiPlan(profile, 'Питание', { AI: {
  async run(model, input, options) {
    assert.ok(options?.signal instanceof AbortSignal, 'fast Llama inference must retain the hard timeout abort signal');
    if (model === '@cf/zai-org/glm-4.7-flash') throw new Error('force the documented fast Llama fallback');
    if (model !== '@cf/meta/llama-3.1-8b-instruct-fast') throw new Error('unexpected fallback model');
    fastLlamaModelInput = input;
    return makeAi(7).run(model, input);
  }
} });
assert.equal(schemaConstrainedPlan.week.length, 7);
assert.equal(fastLlamaModelInput.max_tokens, 6500, 'fast Llama must use its documented max_tokens parameter');
assert.equal(fastLlamaModelInput.max_completion_tokens, undefined, 'fast Llama must not receive the unsupported max_completion_tokens parameter');
assert.deepEqual(fastLlamaModelInput.response_format, {
  type: 'json_schema',
  json_schema: {
    type: 'object',
    properties: { week: { type: 'array', minItems: 7, maxItems: 7, items: { type: 'object' } } },
    required: ['week']
  }
}, 'fast Llama schema must require exactly seven days in the requested block');
assert.equal(fastLlamaModelInput.reasoning_effort, undefined, 'fast Llama should not receive parameters absent from its model input schema');
assert.equal(fastLlamaModelInput.chat_template_kwargs, undefined, 'fast Llama should not receive unsupported chat-template options');
const correctedPortionPlan = await generateAiPlan(profile, 'PRO', { AI: makeAi(14, false, false, false, false, 0.7) });
assert.equal(correctedPortionPlan.week.length, 14, 'server-side portion correction must recover a plan with initially undersized portions');
assert.ok(correctedPortionPlan.week.every(day =>
  day.nutrition.calories >= correctedPortionPlan.calories * 0.8 &&
  day.nutrition.calories <= correctedPortionPlan.calories * 1.2 &&
  day.nutrition.protein >= correctedPortionPlan.protein * 0.8 &&
  day.nutrition.protein <= correctedPortionPlan.protein * 1.2 &&
  day.nutrition.fat >= correctedPortionPlan.fat * 0.7 &&
  day.nutrition.fat <= correctedPortionPlan.fat * 1.3 &&
  day.nutrition.carbs >= correctedPortionPlan.carbs * 0.7 &&
  day.nutrition.carbs <= correctedPortionPlan.carbs * 1.3
), 'server-corrected days must still satisfy strict calorie and macro ranges');
await assert.rejects(
  () => generateAiPlan(profile, 'Питание', { AI: {
    async run() {
      const result = makeAi(7);
      const response = await result.run();
      const parsed = JSON.parse(response.response);
      parsed.week[0].breakfastRecipe = '';
      return { response: JSON.stringify(parsed) };
    }
  } }),
  /временно не вернул текстовый ответ/,
  'plans without practical cooking instructions must be rejected'
);
assert.equal(nutritionPlan.week.length, 7);
assert.equal(nutritionPlan.menuDays, 7);
assert.equal(nutritionPlan.durationDays, 7);

await assert.rejects(
  () => generateAiPlan(profile, 'PRO', { AI: makeAi(14, true) }),
  /временно не вернул текстовый ответ/,
  'PRO must reject an AI response containing only seven days'
);
await assert.rejects(
  () => generateAiPlan(profile, 'Premium', { AI: makeAi(30, true) }),
  /временно не вернул текстовый ответ/,
  'Premium must reject a 14-day response and require all 30 days'
);

await assert.rejects(
  () => generateAiPlan(profile, 'PRO', { AI: makeAi(14, false, true, false) }),
  /временно не вернул текстовый ответ/,
  'plans without explicit meal portions must be rejected'
);
await assert.rejects(
  () => generateAiPlan(profile, 'PRO', { AI: makeAi(14, false, false, true) }),
  /временно не вернул текстовый ответ/,
  'training days without sets or repetitions must be rejected'
);
await assert.rejects(
  () => generateAiPlan(profile, 'PRO', { AI: makeAi(14, false, false, false, true) }),
  /временно не вернул текстовый ответ/,
  'days with implausibly low calculated calories and protein must be rejected'
);

let nutritionRetryCalls = 0;
const nutritionRetryModels = [];
const nutritionRetryAi = {
  async run(model, input) {
    nutritionRetryCalls++;
    nutritionRetryModels.push(model);
    const fixture = nutritionRetryCalls <= 2 ? makeAi(7, false, false, false, true) : makeAi(7);
    return fixture.run(model, input);
  }
};
const recoveredNutritionPlan = await generateAiPlan(profile, 'Питание', { AI: nutritionRetryAi });
assert.equal(recoveredNutritionPlan.week.length, 7, 'a corrected fallback-model response must produce a complete plan');
assert.equal(nutritionRetryCalls, 3, 'the plan generator must reach the third fallback after two invalid fast-model responses');
assert.equal(nutritionRetryModels[2], '@cf/google/gemma-4-26b-a4b-it', 'the third attempt must use the configured Gemma fallback model');

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

console.log('PASS: 7/14/30-day plans, calories/protein/fat/carbohydrates, shopping aggregation, workout prescriptions and AI fallback');
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
assert.ok(diagnosticData.days[0].meals.breakfast.ingredients.length > 0);
assert.ok(diagnosticData.days[0].meals.breakfast.recipe.length >= 15, 'diagnostic must expose practical cooking instructions');
assert.ok(diagnosticData.days[0].calculatedNutrition.calories > 0);
assert.ok(diagnosticData.days[0].calculatedNutrition.protein > 0);
assert.ok(diagnosticData.days[0].calculatedNutrition.fat > 0);
assert.ok(diagnosticData.days[0].calculatedNutrition.carbs > 0);
assert.ok(diagnosticData.targets.fat > 0 && diagnosticData.targets.carbs > 0);
assert.ok(diagnosticData.shopping.length > 0);
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
assert.ok(workerSource.includes('await saveMemberPlan(env, accessToken, profile, plan)'), 'integration diagnostic must save the generated plan and profile to D1');
assert.ok(workerSource.includes('verifyGitHubActionsOidc(request)'), 'live diagnostic must authenticate GitHub Actions using OIDC');
assert.ok(workerSource.includes("claims.aud !== 'fitalpro-ai-data-flow'"), 'OIDC authorization must restrict the token audience');
assert.ok(workerSource.includes("claims.ref !== 'refs/heads/main'"), 'OIDC authorization must restrict execution to the production branch');
assert.ok(workerSource.includes('vladimirdemenin5-pixel@324070911/fital-pro@1354815283:ref:refs/heads/main'), 'OIDC authorization must accept the repository immutable subject claim');
assert.ok(workerSource.includes('env.FITALPRO_CI_TEST_KEY || env.ROBOKASSA_TEST_ACCESS_KEY'), 'integration diagnostic must support the temporary CI-only key without changing the Robokassa test key');
assert.ok(workerSource.includes("personalizedPlan(new Request('https://fitalpro.internal/api/plan'"), 'integration diagnostic must read the saved plan through the personal-cabinet API');
assert.ok(workerSource.includes("profileApi(new Request('https://fitalpro.internal/api/profile'"), 'integration diagnostic must read the saved profile through the personal-cabinet API');
assert.ok(workerSource.includes("DELETE FROM weekly_plans WHERE access_token=?"), 'temporary diagnostic plans must be cleaned up after verification');
assert.ok(workerSource.includes("DELETE FROM subscriptions WHERE access_token=?"), 'temporary diagnostic access must be cleaned up after verification');
console.log('PASS: protected AI → D1 → personal-cabinet diagnostic and cleanup');

