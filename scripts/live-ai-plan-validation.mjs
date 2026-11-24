import { request as httpsRequest } from 'node:https';

const endpoint = process.env.FITALPRO_WORKER_URL || '';
if (!endpoint) throw new Error('FITALPRO_WORKER_URL must point to the explicitly selected production Worker or PR Preview Worker.');
const endpointUrl = new URL(endpoint);
const target = process.env.FITALPRO_AI_TARGET || 'preview';
const allowedHostname = target === 'production'
  ? endpointUrl.hostname === 'red-waterfall-2af8.vladimirdemenin5.workers.dev'
  : target === 'preview' &&
    endpointUrl.hostname.startsWith('fital-pro-redesign-groq-ready-red-waterfall-2af8.') &&
    endpointUrl.hostname.endsWith('.workers.dev');
if (endpointUrl.protocol !== 'https:' || !allowedHostname) {
  throw new Error('Refusing live AI plan check: target must be the explicitly selected production Worker or PR #53 Preview Worker.');
}

async function postJson(url, body, headers, timeoutMs) {
  const transientCodes = new Set(['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT', 'EAI_AGAIN']);
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await new Promise((resolve, reject) => {
        const request = httpsRequest(url, { method: 'POST', headers }, response => {
          let text = '';
          response.setEncoding('utf8');
          response.on('data', chunk => { text += chunk; });
          response.on('end', () => {
            let data = {};
            try { data = JSON.parse(text); } catch {}
            const status = response.statusCode || 0;
            resolve({ ok: status >= 200 && status < 300, status, data });
          });
        });
        request.setTimeout(timeoutMs, () => {
          const error = new Error('AI diagnostic timed out.');
          error.code = 'ETIMEDOUT';
          request.destroy(error);
        });
        request.on('error', reject);
        request.write(JSON.stringify(body));
        request.end();
      });
    } catch (error) {
      if (!transientCodes.has(error?.code) || attempt === maxAttempts) throw error;
      const waitMs = 1500 * attempt;
      console.warn(`Temporary AI diagnostic connection error (${error.code}); retrying attempt ${attempt + 1}/${maxAttempts} in ${waitMs} ms.`);
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
  }
  throw new Error('AI diagnostic request failed after transient retries.');
}

async function getHealth() {
  const response = await fetch(endpoint + '/health', { signal: AbortSignal.timeout(30000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok !== true || data.ai !== true) {
    throw new Error('AI preflight failed: Worker health or AI binding is unavailable.');
  }
  console.log('PASS: AI preflight — Worker AI binding is available; Groq configured:', data.groq === true, '(Cloudflare Workers AI remains the fallback).');
  return data;
}

await getHealth();

const oidcRequestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
const oidcRequestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
if (!oidcRequestUrl || !oidcRequestToken) {
  throw new Error('GitHub Actions OIDC is not enabled for the AI plan check.');
}

async function getOidcToken() {
  const url = new URL(oidcRequestUrl);
  url.searchParams.set('audience', 'fitalpro-ai-data-flow');
  const response = await fetch(url, {
    headers: { Authorization: 'Bearer ' + oidcRequestToken },
    signal: AbortSignal.timeout(30000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.value) throw new Error('Could not obtain the GitHub Actions OIDC identity token.');
  return result.value;
}

const profile = {
  name: 'Fital Pro automated plan validation',
  sex: 'female',
  age: 32,
  height: 168,
  weight: 68,
  activity: 'medium',
  goal: 'maintenance',
  training: 'home',
  days: 3,
  preferences: 'Обычное питание, без аллергий. Синтетические тестовые данные.'
};
const plans = [
  { key: 'PRO', days: 14 }
];

for (const item of plans) {
  const token = await getOidcToken();
  const response = await postJson(
    endpoint + '/api/ai-diagnostic',
    { plan: item.key, profile },
    { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    40 * 60 * 1000
  );
  const result = response.data || {};
  if (!response.ok || result.ok !== true) {
    throw new Error(`${item.key}: AI plan generation failed (HTTP ${response.status}): ${result.error || 'unknown error'}${result.diagnostic ? ' [' + result.diagnostic + ']' : ''}`);
  }
  if (
    result.generationMode !== 'ai' ||
    !Array.isArray(result.aiProviders) || result.aiProviders.length === 0 ||
    result.durationDays !== item.days ||
    !Array.isArray(result.days) || result.days.length !== item.days
  ) {
    throw new Error(`${item.key}: returned an incomplete plan or a non-AI fallback.`);
  }

  for (const [index, day] of result.days.entries()) {
    const meals = Object.values(day.meals || {});
    const expectedTrainingDay = Math.floor(((index % 7) + 1) * profile.days / 7) >
      Math.floor((index % 7) * profile.days / 7);
    if (
      day.day !== 'День ' + (index + 1) ||
      day.trainingDay !== expectedTrainingDay ||
      typeof day.workout !== 'string' ||
      day.workout.trim().length < 15 ||
      (expectedTrainingDay && !/[0-9]+[ \t]*(?:[×xх][ \t]*[0-9]+|подход(?:а|ов)?|повтор(?:а|ений)?)/i.test(day.workout)) ||
      meals.length !== 4 ||
      meals.some(meal =>
        typeof meal.title !== 'string' || !meal.title.trim() ||
        typeof meal.recipe !== 'string' || meal.recipe.trim().length < 15 ||
        !Array.isArray(meal.ingredients) || meal.ingredients.length < 2 ||
        meal.ingredients.some(ingredient =>
          !ingredient.foodId || !ingredient.name ||
          !Number.isInteger(ingredient.grams) || ingredient.grams < 5 || ingredient.grams > 500
        )
      ) ||
      !day.calculatedNutrition ||
      !Number.isFinite(result.targets?.calories) ||
      result.targets.calories <= 0 ||
      !Number.isFinite(day.calculatedNutrition.calories) ||
      day.calculatedNutrition.calories < result.targets.calories * 0.90 ||
      day.calculatedNutrition.calories > result.targets.calories * 1.10 ||
      !['protein', 'fat', 'carbs'].every(key =>
        Number.isFinite(day.calculatedNutrition[key]) && day.calculatedNutrition[key] >= 0
      )
    ) {
      throw new Error(`${item.key}: day ${index + 1} is missing a complete meal, recipe, ingredients, or calculated nutrition.`);
    }
  }

  const trainingDays = result.days.filter(day => day.trainingDay).length;
  if (trainingDays !== 6) {
    throw new Error(item.key + ': expected six scheduled training days across two complete weeks, received ' + trainingDays + '.');
  }
  if (!Array.isArray(result.shopping) || result.shopping.length === 0 ||
      typeof result.nutritionSource !== 'string' || !result.nutritionSource.includes('USDA FoodData Central')) {
    throw new Error(item.key + ': shopping list or nutrition reference is missing.');
  }
  console.log(JSON.stringify({
    plan: item.key,
    generationMode: result.generationMode,
    aiProviders: result.aiProviders,
    days: result.days.length,
    meals: result.days.length * 4,
    trainingDays,
    workoutsAndRecoveryValidated: true,
    shoppingItems: Array.isArray(result.shopping) ? result.shopping.length : 0,
    dailyAverage: result.dailyAverage,
    persistence: 'not performed',
    payment: 'not created'
  }));
}
console.log('PASS: real AI generated and validated the complete 14-day PRO menu and training schedule without writing to D1 or creating payments.');
