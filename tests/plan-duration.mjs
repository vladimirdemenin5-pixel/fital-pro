import assert from 'node:assert/strict';
import { generateAiPlan } from '../_worker.js';

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

function makeAi(menuDays, wrongLength = false) {
  return {
    async run() {
      const count = wrongLength ? 7 : menuDays;
      const week = Array.from({ length: count }, (_, index) => {
        const dayInWeek = index % 7;
        const trainingDay = dayInWeek === 0 || dayInWeek === 2 || dayInWeek === 4;
        return {
          day: 'День ' + (index + 1),
          trainingDay,
          breakfast: 'Овсянка 200 г и йогурт 150 г',
          lunch: 'Курица 150 г, рис 100 г и овощи 200 г',
          snack: 'Творог 150 г и яблоко',
          dinner: 'Рыба 150 г и овощи 200 г',
          workout: trainingDay ? 'Разминка, приседания 3×10, тяга 3×10, заминка' : 'Прогулка и восстановление'
        };
      });
      return { response: JSON.stringify({ intro: 'План создан по тестовой анкете.', week, shopping: ['Продукты на весь период'], tips: ['Пейте воду по жажде.'] }) };
    }
  };
}

for (const planKey of ['PRO', 'Premium']) {
  const plan = await generateAiPlan(profile, planKey, { AI: makeAi(14) });
  assert.equal(plan.week.length, 14, planKey + ' must contain 14 complete menu days');
  assert.equal(plan.menuDays, 14);
  assert.equal(plan.week[0].day, 'День 1');
  assert.equal(plan.week[13].day, 'День 14');
  assert.equal(plan.week.slice(0, 7).filter(day => day.trainingDay).length, 3);
  assert.equal(plan.week.slice(7, 14).filter(day => day.trainingDay).length, 3);
}
const nutritionPlan = await generateAiPlan(profile, 'Питание', { AI: makeAi(7) });
assert.equal(nutritionPlan.week.length, 7);
assert.equal(nutritionPlan.menuDays, 7);
assert.equal(nutritionPlan.durationDays, 7);

await assert.rejects(
  () => generateAiPlan(profile, 'PRO', { AI: makeAi(14, true) }),
  /временно не вернул текстовый ответ/,
  'PRO must reject an AI response containing only seven days'
);

console.log('PASS: 7-day Nutrition and 14-day PRO/Premium menu generation');
