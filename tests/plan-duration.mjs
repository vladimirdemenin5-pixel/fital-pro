import assert from 'node:assert/strict';
import { generateAiPlan, runAiTextWithFallback } from '../_worker.js';
import { readFile } from 'node:fs/promises';

const workerSource = await readFile(new URL('../_worker.js', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const htmlSource = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

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
assert.deepEqual(proPlan.week[0].nutrition, { calories: 1935, protein: 95 });
assert.equal(proPlan.dailyAverage.calories, 1935);
assert.equal(proPlan.dailyAverage.protein, 95);
assert.ok(proPlan.shopping.includes('Овсяные хлопья, сухие — 1,1 кг'));
assert.ok(proPlan.shopping.includes('Молоко 2% — 2,8 кг'));
assert.ok(!proPlan.shopping.includes('Продукты на весь период'));
assert.ok(proPlan.nutritionSource.includes('USDA FoodData Central'));
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

console.log('PASS: 7/14/30-day plans, USDA-based nutrition totals, shopping aggregation, workout prescriptions and AI fallback');
assert.ok(workerSource.includes("'Premium': { amount: '3990.00', label: 'Fital Pro Premium — меню и тренировки, 30 дней', days: 30, menuDays: 30 }"), 'Premium must configure 30 menu days');
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
