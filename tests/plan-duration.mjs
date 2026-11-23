import assert from 'node:assert/strict';
import { generateAiPlan, runAiTextWithFallback, runAiInferenceWithTimeout, aiPlanDiagnostic, aiDataFlowDiagnostic, FOOD_CATALOG, buildPlanResponseSchema, diagnosePlanWeekFailure, rebalanceDayNutrition, foodAllowedByPreferences, foodRole, foodCanReplaceFood, foodFitsMeal } from '../_worker.js';
import { readFile } from 'node:fs/promises';

const workerSource = await readFile(new URL('../_worker.js', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const htmlSource = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const productionWorkflow = await readFile(new URL('../.github/workflows/main.yml', import.meta.url), 'utf8');
assert.ok(Object.entries(FOOD_CATALOG).length >= 30, 'food reference catalog must remain populated');
assert.ok(productionWorkflow.includes("if: github.event_name == 'workflow_dispatch' && inputs.run_live_ai == true"),
  'live AI generation must require an explicit manual workflow dispatch so ordinary production deployments do not consume Workers AI quota');
assert.ok(productionWorkflow.includes('run_live_ai:') && productionWorkflow.includes('type: boolean') && productionWorkflow.includes('default: false'),
  'manual live AI checks must default to off');
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

const macroCorrectionDay = {
  day: 'День 1',
  trainingDay: false,
  breakfast: 'Омлет',
  breakfastRecipe: 'Приготовь продукты до готовности и подай вместе.',
  breakfastIngredients: [{ foodId: 'egg_raw', name: FOOD_CATALOG.egg_raw.name, grams: 200 }],
  lunch: 'Индейка',
  lunchRecipe: 'Приготовь продукты до готовности и подай вместе.',
  lunchIngredients: [{ foodId: 'turkey_raw', name: FOOD_CATALOG.turkey_raw.name, grams: 250 }],
  snack: 'Йогурт',
  snackRecipe: 'Приготовь продукты до готовности и подай вместе.',
  snackIngredients: [{ foodId: 'greek_yogurt', name: FOOD_CATALOG.greek_yogurt.name, grams: 300 }],
  dinner: 'Треска',
  dinnerRecipe: 'Приготовь продукты до готовности и подай вместе.',
  dinnerIngredients: [{ foodId: 'cod_raw', name: FOOD_CATALOG.cod_raw.name, grams: 250 }]
};
const lowEnergyDay = {
  ...macroCorrectionDay,
  breakfastIngredients: [{ foodId:'oats_dry', name:FOOD_CATALOG.oats_dry.name, grams:5 }],
  lunchIngredients: [{ foodId:'chicken_raw', name:FOOD_CATALOG.chicken_raw.name, grams:5 }],
  snackIngredients: [{ foodId:'greek_yogurt', name:FOOD_CATALOG.greek_yogurt.name, grams:5 }],
  dinnerIngredients: [{ foodId:'cod_raw', name:FOOD_CATALOG.cod_raw.name, grams:5 }]
};
const lowEnergyBefore = JSON.stringify(lowEnergyDay);
assert.equal(rebalanceDayNutrition(lowEnergyDay, { calories:1800, protein:90, fat:58, carbs:225 }, profile), false,
  'a severely incomplete low-energy draft must be rejected for AI retry instead of being fabricated from catalog foods');
assert.equal(JSON.stringify(lowEnergyDay), lowEnergyBefore, 'the low-energy guard must not mutate the rejected draft');

const originalMacroFoodIds = ['breakfast','lunch','snack','dinner'].flatMap(key => macroCorrectionDay[key + 'Ingredients'].map(item => item.foodId));
const macroCorrectionSucceeded = rebalanceDayNutrition(macroCorrectionDay, {
  calories: 1800, protein: 90, fat: 58, carbs: 225
}, profile);
assert.equal(macroCorrectionSucceeded, true, 'server correction must change the food composition when portion-only tuning cannot balance protein, fat and carbohydrates');
assert.ok(macroCorrectionDay.nutrition.calories >= 1440 && macroCorrectionDay.nutrition.calories <= 2160);
assert.ok(macroCorrectionDay.nutrition.protein >= 72 && macroCorrectionDay.nutrition.protein <= 108);
assert.ok(macroCorrectionDay.nutrition.fat >= 40.6 && macroCorrectionDay.nutrition.fat <= 75.4);
assert.ok(macroCorrectionDay.nutrition.carbs >= 157.5 && macroCorrectionDay.nutrition.carbs <= 292.5);
const correctedMacroFoodIds = ['breakfast','lunch','snack','dinner'].flatMap(key => macroCorrectionDay[key + 'Ingredients'].map(item => item.foodId));
assert.notDeepEqual(correctedMacroFoodIds, originalMacroFoodIds, 'the correction must actually replace products from the catalog');
assert.ok(['breakfast','lunch','snack','dinner'].some(key => macroCorrectionDay[key + 'Recipe'].length >= 20 && macroCorrectionDay[key + 'Recipe'].toLowerCase().includes('приготов')), 'the recipe must be synchronized with changed ingredients');
for (const key of ['breakfast','lunch','snack','dinner']) {
  assert.ok(macroCorrectionDay[key+'Ingredients'].every(item => foodFitsMeal(item.foodId, key)), key + ' correction must keep every ingredient compatible with its meal');
  assert.ok(macroCorrectionDay[key+'Ingredients'].every(item => foodAllowedByPreferences(item.foodId, profile)), key + ' correction must preserve client food restrictions');
}
assert.equal(foodAllowedByPreferences('greek_yogurt', { preferences: 'Без молочных продуктов' }), false, 'replacement candidates must respect dairy restrictions');
assert.equal(foodAllowedByPreferences('milk_2pct', { preferences: 'Без молока' }), false, 'inflected dairy restrictions must also be recognized');
assert.equal(foodAllowedByPreferences('chicken_raw', { preferences: 'Вегетарианство' }), false, 'replacement candidates must respect vegetarian restrictions');
assert.equal(foodAllowedByPreferences('rice_dry', { preferences: 'Без глютена' }), true, 'gluten-free restrictions must keep safe catalog alternatives available');

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

const quotaAttemptedModels = [];
const quotaFallbackPlan = await generateAiPlan(profile, 'Питание', { AI: {
  async run(model) {
    quotaAttemptedModels.push(model);
    throw new Error('4006: you have used up your daily free allocation of 10,000 neurons');
  }
} });
assert.equal(quotaFallbackPlan.generationMode, 'catalog-fallback',
  'an exhausted Workers AI quota must switch to the validated server-side catalog planner instead of blocking checkout');
assert.equal(quotaFallbackPlan.week.length, 7);
assert.equal(quotaAttemptedModels.length, 1, 'generation must stop after the first block detects exhausted quota');
assert.equal(quotaAttemptedModels[0], '@cf/qwen/qwen3.8-27b');
assert.ok(quotaFallbackPlan.week.every(day => day.nutrition.calories >= quotaFallbackPlan.calories * 0.8 &&
  day.nutrition.calories <= quotaFallbackPlan.calories * 1.2 &&
  day.nutrition.protein >= quotaFallbackPlan.protein * 0.8 &&
  day.nutrition.protein <= quotaFallbackPlan.protein * 1.2 &&
  day.nutrition.fat >= quotaFallbackPlan.fat * 0.7 &&
  day.nutrition.fat <= quotaFallbackPlan.fat * 1.3 &&
  day.nutrition.carbs >= quotaFallbackPlan.carbs * 0.7 &&
  day.nutrition.carbs <= quotaFallbackPlan.carbs * 1.3),
  'every fallback day must pass the same strict calculated macro ranges as an AI-generated day');

const noProviderNutritionPlan = await generateAiPlan(profile, 'Питание', {});
assert.equal(noProviderNutritionPlan.generationMode, 'catalog-fallback');
assert.equal(noProviderNutritionPlan.week.length, 7);

const noProviderProPlan = await generateAiPlan(profile, 'PRO', {});
assert.equal(noProviderProPlan.generationMode, 'catalog-fallback');
assert.equal(noProviderProPlan.week.length, 14);
assert.equal(noProviderProPlan.week.filter(day => day.trainingDay).length, 6,
  'catalog fallback must preserve the exact server-owned PRO training schedule');

const noProviderPremiumPlan = await generateAiPlan(profile, 'Premium', {});
assert.equal(noProviderPremiumPlan.generationMode, 'catalog-fallback');
assert.equal(noProviderPremiumPlan.week.length, 30);
assert.equal(noProviderPremiumPlan.week.filter(day => day.trainingDay).length, 12,
  'catalog fallback must preserve the exact server-owned Premium training schedule');

const veganFallbackPlan = await generateAiPlan({
  ...profile,
  preferences: 'Веганство, без молочных продуктов, яиц, рыбы и мяса'
}, 'Питание', {});
assert.equal(veganFallbackPlan.generationMode, 'catalog-fallback');
assert.ok(veganFallbackPlan.week.every(day =>
  ['breakfast','lunch','snack','dinner'].every(key =>
    day[key + 'Ingredients'].every(item => foodAllowedByPreferences(item.foodId, {
      preferences: 'Веганство, без молочных продуктов, яиц, рыбы и мяса'
    }))
  )
), 'catalog fallback must strictly respect vegan restrictions');

const proPlan = await generateAiPlan(profile, 'PRO', { AI: makeAi(14) });
assert.equal(proPlan.week.length, 14, 'PRO must contain 14 complete menu days');
assert.equal(proPlan.menuDays, 14);
assert.equal(proPlan.week[0].day, 'День 1');
assert.equal(proPlan.week[13].day, 'День 14');
assert.deepEqual(proPlan.week[0].nutrition, { calories: 1872, protein: 98.1, fat: 63, carbs: 237.1 });
assert.equal(proPlan.dailyAverage.calories, 1872);
assert.equal(proPlan.dailyAverage.protein, 98.1);
assert.equal(proPlan.dailyAverage.fat, 63);
assert.equal(proPlan.dailyAverage.carbs, 237.1);
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
    day.nutrition.calories >= oversizedIngredientPlan.calories * 0.8 &&
    day.nutrition.calories <= oversizedIngredientPlan.calories * 1.2 &&
    day.nutrition.fat >= oversizedIngredientPlan.fat * 0.7 &&
    day.nutrition.fat <= oversizedIngredientPlan.fat * 1.3;
}), 'a globally valid ingredient portion above its product-specific ceiling must be clamped and the resulting full day must still pass strict nutrition validation');
const invalidPortionFallback = await generateAiPlan(profile, 'Питание', { AI: {
  async run(model, input) {
    const result = await makeAi(7).run(model, input);
    const parsed = JSON.parse(result.response);
    parsed.week[0].breakfastIngredients[0].grams = 501;
    return { response: JSON.stringify(parsed) };
  }
} });
assert.equal(invalidPortionFallback.generationMode, 'catalog-fallback',
  'an AI response with a portion outside the global 5–500g range must be replaced by a safe catalog plan');
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
assert.ok(proPlan.shopping.includes('Овсяные хлопья, сухие — 1,12 кг'));
assert.ok(proPlan.shopping.includes('Молоко 2% — 2,8 кг'));
assert.ok(!proPlan.shopping.includes('Продукты на весь период'));
assert.ok(proPlan.nutritionSource.includes('USDA FoodData Central'));
assert.ok(workerSource.includes('fdcId:173904'), 'oats reference must retain its USDA food record identifier');
assert.ok(workerSource.includes('for (let offset = 0; offset < totalDays; offset += 2)') && workerSource.includes('const chunkDays = Math.min(2, totalDays - offset)') && !workerSource.includes('Promise.all([0, 2, 4, 6]'), 'long plans must be generated as sequential validated two-day blocks');
assert.ok(workerSource.includes('MAX_MEAL_INGREDIENT_GRAMS') && workerSource.includes('min:5,max:') && workerSource.includes('for (let iteration=0;iteration<120;iteration++)') && workerSource.includes('const nutrientTargets = [targets.calories, targets.protein, targets.fat, targets.carbs];') && workerSource.includes('const derivatives=values.map(') && workerSource.includes('let learningRate=1000;') && workerSource.includes('const allowedFoods = Object.keys(FOOD_CATALOG).filter(id => foodAllowedByPreferences(id, profile));'), 'portion and food-choice correction must use bounded catalog search without relaxing nutrition ranges');
assert.ok(workerSource.includes('const rejectionDiagnostics = [];') && workerSource.includes('rejectionDiagnostics.slice(-3)'), 'the next fallback model must receive concrete rejection reasons from the previous model');
assert.ok(workerSource.includes("...(env.AI ? ['@cf/qwen/qwen3.8-27b', '@cf/openai/gpt-oss-120b', '@cf/openai/gpt-oss-20b'] : [])") &&
  workerSource.includes("...(clean(env.GROQ_API_KEY, 300) ? ['groq:openai/gpt-oss-20b'] : [])"),
  'plan generation must use an optional Groq GPT-OSS 20B provider and only the bounded Cloudflare Qwen/GPT-OSS fallback chain');
assert.ok(workerSource.includes('for (let move = 0; move < 20; move++)') && workerSource.includes('!foodFitsMeal(foodId, key)'), 'nutrition correction must search more composition changes and keep replacement foods compatible with their meal');
assert.ok(workerSource.includes('rejectIfBusy: true'), 'Workers AI must skip a busy model queue and fall back instead of waiting until the request times out');
assert.ok(workerSource.includes('const AI_MODEL_TIMEOUT_MS = 45000;') && workerSource.includes('Promise.race([') && workerSource.includes('runAiInferenceWithTimeout(env, model'), 'each plan-model inference must have a hard timeout so a stalled model cannot block fallbacks');
assert.ok(workerSource.includes("...(env.AI ? ['@cf/zai-org/glm-4.7-flash', '@cf/meta/llama-3.1-8b-instruct-fast', MODEL] : [])"),
  'general chat must retain Cloudflare fallbacks when the binding is present');
assert.ok(workerSource.includes('max_tokens: 4200') && workerSource.includes('max_completion_tokens: 4200') && workerSource.includes('QWEN_PLAN_TIMEOUT_MS = 75000') && workerSource.includes('GPT_OSS_PLAN_TIMEOUT_MS = 60000') && workerSource.includes('AI_PLAN_FALLBACK_TIMEOUT_MS = 60000'), 'each Workers AI plan model must use its documented token-limit parameter and bounded timeout');
assert.ok(workerSource.includes("const isGptOss = model === '@cf/openai/gpt-oss-120b' || model === '@cf/openai/gpt-oss-20b'") && workerSource.includes('max_tokens: 4200') && workerSource.includes("reasoning_effort: 'low'"), 'both GPT-OSS fallbacks must use supported token limits and bounded reasoning');
assert.ok(!workerSource.includes('QWEN4_API_KEY') && !workerSource.includes('qwen4-max'), 'paid QwenCloud integration must be absent from the Cloudflare-only model chain');
assert.ok(workerSource.includes('function buildPlanResponseSchema(menuDays)') && workerSource.includes('minItems: menuDays') && workerSource.includes('maxItems: menuDays'), 'the reusable server schema helper must still describe exact plan length');
assert.ok(workerSource.includes("reasoning_effort: 'low'"), 'reasoning must be bounded to low for structured meal-plan generation');
assert.ok(workerSource.includes('const aiOptions = {') && workerSource.includes('env.AI.run(model, aiOptions, { rejectIfBusy: true })'), 'the AI chat fallback must also disable reasoning before inference');
assert.ok(workerSource.includes("https://api.groq.com/openai/v1/chat/completions") &&
  workerSource.includes("Authorization: 'Bearer ' + apiKey") &&
  workerSource.includes("response_format: { type: 'json_object' }") &&
  workerSource.includes("reasoning_format: 'hidden'"),
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
    if (startDay === 1 && model === '@cf/qwen/qwen3.8-27b') {
      const error = new Error('simulated model timeout');
      error.name = 'TimeoutError';
      throw error;
    }
    return makeAi(7).run(model, input);
  }
} });
assert.equal(timeoutRecoveredPlan.week.length, 7, 'a timed-out first model must fall back to the next available model');
assert.equal(timeoutFallbackModelsByBlock.get(1)?.[1], '@cf/openai/gpt-oss-120b', 'the same two-day block must fall back from Qwen 3.8 to OpenAI GPT-OSS 120B');
assert.equal(timeoutFallbackModelsByBlock.get(3)?.[0], '@cf/qwen/qwen3.8-27b', 'the next two-day block must start with its own Qwen primary call');
let qwenModelInput = null;
const qwenPrimaryPlan = await generateAiPlan(profile, 'Питание', { AI: {
  async run(model, input, options) {
    assert.equal(model, '@cf/qwen/qwen3.8-27b', 'Qwen 3.8 must be the first plan-generation model');
    assert.ok(options?.signal instanceof AbortSignal, 'Qwen inference must retain the hard timeout abort signal');
    qwenModelInput = input;
    return makeAi(7).run(model, input);
  }
} });
assert.equal(qwenPrimaryPlan.week.length, 7);
assert.equal(qwenModelInput.max_completion_tokens, 4200);
assert.equal(qwenModelInput.reasoning_effort, 'low', 'Qwen reasoning must be bounded to low for structured meal-plan output');
assert.equal(qwenModelInput.response_format, undefined, 'do not send unsupported Cloudflare JSON Mode parameters to Qwen');
const qwenPrompt = qwenModelInput.messages[1].content;
assert.ok(qwenPrompt.includes('"name":"Клиент"') && !qwenPrompt.includes('Тестовый клиент'), 'all Cloudflare AI models must receive an anonymized client name');
assert.ok(qwenPrompt.includes('белки') && qwenPrompt.includes('жиры') && qwenPrompt.includes('углеводы'),
  'the model must receive separate per-meal macro targets, not only a daily calorie target');
assert.ok(qwenPrompt.includes('2–4 объекта') && qwenPrompt.includes('"olive_oil":20'),
  'the model must leave safe correction capacity and receive product-specific portion limits');
let gptModelInput = null;
let gpt20ModelInput = null;
const gptRepairAttemptsByStart = new Map();
const gptRepairModelsByStart = new Map();
const gptRepairPlan = await generateAiPlan(profile, 'Питание', { AI: {
  async run(model, input) {
    if (model === '@cf/qwen/qwen3.8-27b') throw new Error('Qwen unavailable for repair regression');
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
assert.equal(gptRepairAttemptsByStart.get(3), 1, 'valid GPT-OSS 120B output must not trigger an unnecessary retry');
assert.equal(gpt20ModelInput.max_tokens, 4200);
assert.equal(gpt20ModelInput.reasoning_effort, 'low');

const gptFallbackPlan = await generateAiPlan(profile, 'Питание', { AI: {
  async run(model, input) {
    if (model === '@cf/qwen/qwen3.8-27b') throw new Error('Qwen primary intentionally unavailable in this test');
    assert.equal(model, '@cf/openai/gpt-oss-120b', 'GPT-OSS must be the first fallback after Qwen 3.8');
    gptModelInput = input;
    return makeAi(7).run(model, input);
  }
} });
assert.equal(gptFallbackPlan.week.length, 7, 'GPT-OSS fallback must produce a complete server-validated seven-day plan');
assert.equal(gptModelInput.max_tokens, 4200);
assert.equal(gptModelInput.reasoning_effort, 'low');
assert.equal(gptModelInput.response_format, undefined, 'do not send undocumented JSON Mode to GPT-OSS; validate its JSON response server-side');
assert.ok(workerSource.includes('заменять или добавлять продукты') && workerSource.includes('Для углеводов используй подходящие крупи') === false && workerSource.includes('Для углеводов используй подходящие крупы'), 'AI fallback correction must be allowed to add catalog carbohydrate sources when needed');
assert.ok(workerSource.includes('верни полный JSON') || workerSource.includes('Верни полный JSON'), 'correction prompt must request the complete plan JSON');
const diagnosticSource = JSON.parse((await makeAi(7).run()).response);
diagnosticSource.week[0].snackRecipe = 'Смешать.';
const multiFailureReason = diagnosePlanWeekFailure(diagnosticSource, profile, 'Питание', 7, {
  calories: 2600, protein: 150, fat: 100, carbs: 350
});
assert.ok(multiFailureReason.includes('day-1-snack-recipe-short-or-missing'), 'diagnostics must preserve recipe-length errors');
assert.ok(multiFailureReason.includes('day-1-calories=') && multiFailureReason.includes('day-1-carbs='), 'diagnostics must also include macro errors even when the recipe is invalid');

const correctedPortionPlan = await generateAiPlan(profile, 'PRO', { AI: makeAi(14, false, false, false, false, 0.7) });
const underPortionRetryAI = makeRetryAi(7, 0.4, 0.7);
let lowEnergyCorrectionPrompt = '';
const lowEnergyFallbackPlan = await generateAiPlan(profile, 'Питание', { AI: {
  async run(model, input) {
    if (model === '@cf/qwen/qwen3.8-27b') {
      return makeAi(7, false, false, false, true).run(model, input);
    }
    if (model === '@cf/openai/gpt-oss-120b') {
      lowEnergyCorrectionPrompt = input.messages.at(-1).content;
      return makeAi(7).run(model, input);
    }
    throw new Error('unexpected model after low-energy rejection');
  }
} });
assert.equal(lowEnergyFallbackPlan.week.length, 7);
assert.ok(lowEnergyCorrectionPrompt.includes('day-1-calories=') || lowEnergyCorrectionPrompt.includes('day-1-protein='), 'the next model must receive concrete server nutrition diagnostics');
assert.ok(lowEnergyCorrectionPrompt.includes('ниже 50%') && lowEnergyCorrectionPrompt.includes('не пытайся исправлять'), 'the correction prompt must preserve the strict under-50% full-regeneration rule');
const severelyUnderPortionedPlan = await generateAiPlan(profile, 'Питание', { AI: underPortionRetryAI });
assert.ok(underPortionRetryAI.calls >= 2, 'an under-50% AI draft must be rejected and the next model must generate a complete replacement plan');
const severelyOverProteinPlan = await generateAiPlan(profile, 'Питание', { AI: makeAi(7, false, false, false, false, 1.4) });
const mixedMacroRecovery = await generateAiPlan(profile, 'Питание', { AI: {
  async run(model, input) {
    const response = await makeAi(7).run(model, input);
    const parsed = JSON.parse(response.response);
    for (const day of parsed.week) {
      const setPortion = (meal, foodId, grams) => {
        const ingredient = day[meal + 'Ingredients'].find(item => item.foodId === foodId);
        if (ingredient) ingredient.grams = grams;
      };
      setPortion('breakfast', 'oats_dry', 15);
      setPortion('breakfast', 'banana', 20);
      setPortion('lunch', 'chicken_raw', 220);
      setPortion('lunch', 'rice_dry', 15);
      setPortion('snack', 'greek_yogurt', 250);
      setPortion('snack', 'apple', 20);
      setPortion('snack', 'almonds', 30);
      setPortion('dinner', 'salmon_raw', 180);
      setPortion('dinner', 'potato_raw', 20);
    }
    return { response: JSON.stringify(parsed) };
  }
} });
assert.equal(mixedMacroRecovery.week.length, 7, 'mixed protein excess and carbohydrate deficit must be recovered by paired portion correction');
for (const day of mixedMacroRecovery.week) {
  assert.ok(day.nutrition.calories >= mixedMacroRecovery.calories * 0.8 && day.nutrition.calories <= mixedMacroRecovery.calories * 1.2);
  assert.ok(day.nutrition.protein >= mixedMacroRecovery.protein * 0.8 && day.nutrition.protein <= mixedMacroRecovery.protein * 1.2);
  assert.ok(day.nutrition.fat >= mixedMacroRecovery.fat * 0.7 && day.nutrition.fat <= mixedMacroRecovery.fat * 1.3);
  assert.ok(day.nutrition.carbs >= mixedMacroRecovery.carbs * 0.7 && day.nutrition.carbs <= mixedMacroRecovery.carbs * 1.3);
}
for (const [label, plan] of [['under-portioned', severelyUnderPortionedPlan], ['over-portioned', severelyOverProteinPlan]]) {
  assert.equal(plan.week.length, 7, label + ' AI output must be recoverable when bounded correction can produce a valid menu');
  assert.ok(plan.week.every(day =>
    day.nutrition.calories >= plan.calories * 0.8 &&
    day.nutrition.calories <= plan.calories * 1.2 &&
    day.nutrition.protein >= plan.protein * 0.8 &&
    day.nutrition.protein <= plan.protein * 1.2 &&
    day.nutrition.fat >= plan.fat * 0.7 &&
    day.nutrition.fat <= plan.fat * 1.3 &&
    day.nutrition.carbs >= plan.carbs * 0.7 &&
    day.nutrition.carbs <= plan.carbs * 1.3
  ), label + ' plan must pass the same strict daily nutrition ranges as live plans');
}
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
const missingRecipeFallback = await generateAiPlan(profile, 'Питание', { AI: {
  async run(model, input) {
    const result = makeAi(7);
    const response = await result.run(model, input);
    const parsed = JSON.parse(response.response);
    parsed.week[0].breakfastRecipe = '';
    return { response: JSON.stringify(parsed) };
  }
} });
assert.equal(missingRecipeFallback.generationMode, 'catalog-fallback');
assert.ok(missingRecipeFallback.week.every(day =>
  ['breakfast','lunch','snack','dinner'].every(key => day[key + 'Recipe'].length >= 15)
), 'invalid AI recipes must be replaced by complete recipes built from the catalog ingredients');
assert.equal(nutritionPlan.week.length, 7);
assert.equal(nutritionPlan.menuDays, 7);
assert.equal(nutritionPlan.durationDays, 7);

const wrongLengthProFallback = await generateAiPlan(profile, 'PRO', { AI: makeAi(14, true) });
assert.equal(wrongLengthProFallback.generationMode, 'catalog-fallback');
assert.equal(wrongLengthProFallback.week.length, 14,
  'PRO must replace an incomplete AI response with a full 14-day catalog plan');
const wrongLengthPremiumFallback = await generateAiPlan(profile, 'Premium', { AI: makeAi(30, true) });
assert.equal(wrongLengthPremiumFallback.generationMode, 'catalog-fallback');
assert.equal(wrongLengthPremiumFallback.week.length, 30,
  'Premium must replace an incomplete AI response with a full 30-day catalog plan');

const missingIngredientsFallback = await generateAiPlan(profile, 'PRO', { AI: makeAi(14, false, true, false) });
assert.equal(missingIngredientsFallback.generationMode, 'catalog-fallback');
assert.ok(missingIngredientsFallback.week.every(day =>
  ['breakfast','lunch','snack','dinner'].every(key => day[key + 'Ingredients'].length > 0)
), 'missing AI portions must be replaced with complete catalog meals');
const missingWorkoutFallback = await generateAiPlan(profile, 'PRO', { AI: makeAi(14, false, false, true) });
assert.equal(missingWorkoutFallback.generationMode, 'catalog-fallback');
assert.ok(missingWorkoutFallback.week.every(day => !day.trainingDay || /\d+×\d+/.test(day.workout)),
  'missing workout prescriptions must be replaced with a complete scheduled session');
const lowNutritionFallback = await generateAiPlan(profile, 'PRO', { AI: makeAi(14, false, false, false, true) });
assert.equal(lowNutritionFallback.generationMode, 'catalog-fallback');
assert.ok(lowNutritionFallback.week.every(day =>
  day.nutrition.calories >= lowNutritionFallback.calories * 0.8 &&
  day.nutrition.calories <= lowNutritionFallback.calories * 1.2
), 'implausibly low AI nutrition must be replaced by a server-calculated plan that passes nutrition validation');

let nutritionRetryCalls = 0;
const nutritionRetryModelsByBlock = new Map();
const nutritionRetryAi = {
  async run(model, input) {
    nutritionRetryCalls++;
    const prompt = Array.isArray(input?.messages)
      ? input.messages.map(message => typeof message?.content === 'string' ? message.content : '').join('\n')
      : '';
    const startDay = Number(prompt.match(/БЛОК: дни ([0-9]+)[–-]/)?.[1] || 0);
    const models = nutritionRetryModelsByBlock.get(startDay) || [];
    models.push(model);
    nutritionRetryModelsByBlock.set(startDay, models);
    const firstBlockNeedsTwoRetries = startDay === 1 && models.length <= 2;
    const fixture = firstBlockNeedsTwoRetries ? makeAi(7, false, false, false, true) : makeAi(7);
    return fixture.run(model, input);
  }
};
const recoveredNutritionPlan = await generateAiPlan(profile, 'Питание', { AI: nutritionRetryAi });
assert.equal(recoveredNutritionPlan.week.length, 7, 'a corrected fallback-model response must produce a complete plan');
assert.equal(nutritionRetryCalls, 6, 'four two-day-or-final-day chunks must keep independent model attempts');
assert.deepEqual(nutritionRetryModelsByBlock.get(1), ['@cf/qwen/qwen3.8-27b', '@cf/openai/gpt-oss-120b', '@cf/openai/gpt-oss-20b'], 'one invalid block must use GPT-OSS 20B as a lower-cost corrective model after GPT-OSS 120B fails validation');
assert.deepEqual(nutritionRetryModelsByBlock.get(3), ['@cf/qwen/qwen3.8-27b'], 'the next two-day block must start with a fresh Qwen request after the previous block is validated');
assert.deepEqual(nutritionRetryModelsByBlock.get(5), ['@cf/qwen/qwen3.8-27b'], 'the third two-day block must start with its own Qwen request');
assert.deepEqual(nutritionRetryModelsByBlock.get(7), ['@cf/qwen/qwen3.8-27b'], 'the final one-day block must also start with its own Qwen request');

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
assert.ok(workerSource.includes("claims.ref === 'refs/heads/main'") && workerSource.includes("(mode === 'production' ? !productionWorkflow : !previewWorkflow)"), 'D1 integration OIDC must remain restricted to the production workflow');
assert.ok(workerSource.includes("env?.FITALPRO_PREVIEW_CI === '1'") && workerSource.includes("claims.ref === 'refs/pull/47/merge'"), 'AI-only preview OIDC must require the isolated preview flag and exact PR merge ref');
assert.ok(workerSource.includes("claims.head_ref === 'fix/ai-plan-generation-three-day-chunks'") && workerSource.includes("claims.base_ref === 'main'"), 'AI-only preview OIDC must restrict the exact source and target branches');
assert.ok(workerSource.includes("preview-ai-generation.yml@refs/pull/47/merge"), 'AI-only preview OIDC must restrict the dedicated preview workflow');
assert.ok(workerSource.includes("verifyGitHubActionsOidc(request, env, 'preview')"), 'only the no-write AI diagnostic may accept the restricted preview OIDC token');
assert.ok(workerSource.includes('vladimirdemenin5-pixel@324070911/fital-pro@1354815283:ref:refs/heads/main'), 'OIDC authorization must accept the repository immutable subject claim');
assert.ok(workerSource.includes('env.FITALPRO_CI_TEST_KEY || env.ROBOKASSA_TEST_ACCESS_KEY'), 'integration diagnostic must support the temporary CI-only key without changing the Robokassa test key');
assert.ok(workerSource.includes("personalizedPlan(new Request('https://fitalpro.internal/api/plan'"), 'integration diagnostic must read the saved plan through the personal-cabinet API');
assert.ok(workerSource.includes("profileApi(new Request('https://fitalpro.internal/api/profile'"), 'integration diagnostic must read the saved profile through the personal-cabinet API');
assert.ok(workerSource.includes("DELETE FROM weekly_plans WHERE access_token=?"), 'temporary diagnostic plans must be cleaned up after verification');
assert.ok(workerSource.includes("DELETE FROM subscriptions WHERE access_token=?"), 'temporary diagnostic access must be cleaned up after verification');
console.log('PASS: protected AI → D1 → personal-cabinet diagnostic and cleanup');

