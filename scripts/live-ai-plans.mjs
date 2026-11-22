import { generateAiPlan } from '../_worker.js';

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
if (!accountId || !apiToken) throw new Error('Cloudflare AI integration credentials are unavailable in the CI environment.');

const ai = {
  async run(model, options) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${encodeURIComponent(model)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(options),
      signal: AbortSignal.timeout(180000)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) {
      const message = (payload.errors || []).map(item => item.message).join('; ') || `Cloudflare AI HTTP ${response.status}`;
      throw new Error(message);
    }
    return payload.result ?? payload;
  }
};

const profile = {
  name: 'Тестовый пользователь',
  sex: 'female',
  age: 32,
  height: 168,
  weight: 68,
  activity: 'medium',
  goal: 'maintenance',
  training: 'home',
  days: 3,
  preferences: 'Обычное питание, без аллергий. Предпочтение простым доступным продуктам.'
};

const plans = [
  { key: 'Питание', days: 7 },
  { key: 'PRO', days: 14 },
  { key: 'Premium', days: 30 }
];

for (const item of plans) {
  const started = Date.now();
  console.log(`LIVE AI: starting ${item.key} (${item.days} days)`);
  const result = await generateAiPlan(profile, item.key, { AI: ai });
  if (result.week.length !== item.days) {
    throw new Error(`${item.key}: expected ${item.days} days, got ${result.week.length}`);
  }
  const meals = result.week.flatMap(day =>
    ['breakfast', 'lunch', 'snack', 'dinner'].map(key => ({
      title: day[key],
      recipe: day[key + 'Recipe'],
      ingredients: day[key + 'Ingredients']
    }))
  );
  if (meals.length !== item.days * 4 ||
      meals.some(meal => !meal.title || !meal.recipe || meal.recipe.length < 15 || !meal.ingredients?.length)) {
    throw new Error(`${item.key}: missing meal, recipe, or ingredients`);
  }
  const avg = result.week.reduce((sum, day) => ({
    calories: sum.calories + day.nutrition.calories,
    protein: sum.protein + day.nutrition.protein,
    fat: sum.fat + day.nutrition.fat,
    carbs: sum.carbs + day.nutrition.carbs
  }), { calories: 0, protein: 0, fat: 0, carbs: 0 });
  for (const key of Object.keys(avg)) avg[key] = Math.round(avg[key] / item.days * 10) / 10;
  console.log(JSON.stringify({
    plan: item.key,
    days: result.week.length,
    meals: meals.length,
    mealsWithRecipesAndIngredients: meals.length,
    dailyAverageKBZHU: avg,
    serverValidation: 'passed',
    durationSeconds: Math.round((Date.now() - started) / 1000)
  }));
}
console.log('PASS: real Cloudflare Workers AI generated and server-validated all three Fital Pro plans.');
