import assert from 'node:assert/strict';
import { generateAiPlan, runAiTextWithFallback, aiPlanDiagnostic, FOOD_CATALOG } from '../_worker.js';
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

function makeAi(menuDays, wrongLength = false, invalidMeal = false, invalidWorkout = false, invalidNutrition = false) {
  return {
    async run() {
      const count = wrongLength ? 7 : menuDays;
      const week = Array.from({ length: count }, (_, index) => {
        const dayInWeek = index % 7;
        const trainingDay = dayInWeek === 0 || dayInWeek === 2 || dayInWeek === 4;
        const tiny = invalidNutrition;
        return {
          day: 'День ' + (index + 1),
          trainingDay,
          breakfast: 'Овсяная каша с бананом',
          breakfastIngredients: invalidMeal ? [] : (tiny ? [['oats_dry', 5]] : [['oats_dry', 80], ['milk_2pct', 200], ['banana', 120]]),
          lunch: 'Курица с рисом и брокколи',
          lunchIngredients: tiny ? [['chicken_raw', 5]] : [['chicken_raw', 100], ['rice_dry', 85], ['broccoli', 100]],
          snack: 'Йогурт с яблоком и миндалём',
          snackIngredients: tiny ? [['greek_yogurt', 5]] : [['greek_yogurt', 150], ['apple', 150], ['almonds', 15]],
          dinner: 'Лосось с картофелем и овощами',
          dinnerIngredients: tiny ? [['salmon_raw', 5]] : [['salmon_raw', 100], ['potato_raw', 200], ['olive_oil', 28], ['tomato', 100], ['avocado', 50]],
          workout: trainingDay ? (invalidWorkout ? 'Разминка, приседания и тяга' : 'Разминка, приседания 3×10, тяга 3×10, заминка') : 'Прогулка и восстановление'
        };
      });
      return { response: JSON.stringify({ intro: 'План создан по тестовой анкете.', week, tips: ['Пейте воду по жажде.'] }) };
    }
  };
}

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
assert.equal(nutritionPlan.week.length, 7);
assert.equal(nutritionPlan.menuDays, 7);
assert.equal(nutritionPlan.durationDays, 7);

await assert.rejects(
  () => generateAiPlan(profile, 'PRO', { AI: makeAi(14, true) }),
  /временно не вернул текстовый ответ/,
  'PRO must reject an AI response containing only seven days'
);
await assert.rejects(
  () => generateAiPlan(profile, 'Premium', { AI: makeAi(14) }),
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
assert.ok(diagnosticData.days[0].calculatedNutrition.calories > 0);
assert.ok(diagnosticData.days[0].calculatedNutrition.protein > 0);
assert.ok(diagnosticData.days[0].calculatedNutrition.fat > 0);
assert.ok(diagnosticData.days[0].calculatedNutrition.carbs > 0);
assert.ok(diagnosticData.targets.fat > 0 && diagnosticData.targets.carbs > 0);
assert.ok(diagnosticData.shopping.length > 0);
assert.ok(workerSource.includes("url.pathname === '/api/ai-diagnostic'"), 'diagnostic route must be registered');
assert.ok(workerSource.includes('async function aiPlanDiagnostic(request, env)'), 'diagnostic route handler must exist');
assert.ok(workerSource.includes('diagnostic path deliberately does not call checkout, rateLimit, or any D1 write'));
assert.ok(workerSource.includes('aiPlanDiagnostic, generateAiPlan'), 'diagnostic handler must be testable');
assert.ok((await readFile(new URL('../public/ai-diagnostic.html', import.meta.url), 'utf8')).includes('noindex,nofollow,noarchive'));

console.log('PASS: protected no-write AI diagnostic endpoint');
