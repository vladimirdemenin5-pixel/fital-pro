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

function postJson(url, body, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    // Use a fresh socket for each long-running AI generation request. Reusing a
    // stale keep-alive socket can cause ECONNRESET after several minutes.
    const request = httpsRequest(url, { method: 'POST', headers, agent: false }, response => {
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
      const error = new Error('AI diagnostic timed out before a complete response was received.');
      error.code = 'ETIMEDOUT';
      request.destroy(error);
    });
    request.on('error', error => {
      reject(new Error(
        'AI diagnostic transport failed (' + (error.code || error.message) +
        '). The Worker may have completed generation without the response reaching CI; inspect the Preview Worker logs before repeating this expensive AI request.'
      ));
    });
    request.write(JSON.stringify(body));
    request.end();
  });
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
const availablePlans = [
  { key: 'Питание', days: 7 },
  { key: 'PRO', days: 14 },
  { key: 'Premium', days: 30 }
];
const requestedPlanKeys = (process.env.FITALPRO_AI_PLANS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);
const plans = requestedPlanKeys.length
  ? availablePlans.filter(item => requestedPlanKeys.includes(item.key))
  : availablePlans;
if (requestedPlanKeys.length && plans.length !== requestedPlanKeys.length) {
  throw new Error('FITALPRO_AI_PLANS contains an unknown or duplicate plan key.');
}
if (!plans.length) throw new Error('FITALPRO_AI_PLANS must select at least one plan.');

const results = [];
const failures = [];

for (const item of plans) {
  const started = Date.now();
  try {
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
    result.plan !== item.key ||
    result.durationDays !== item.days ||
    result.menuDays !== item.days ||
    !Array.isArray(result.days) || result.days.length !== item.days
  ) {
    throw new Error(`${item.key}: returned an incomplete plan or a non-AI fallback.`);
  }

  for (const [index, day] of result.days.entries()) {
    const meals = Object.values(day.meals || {});
    const includesTraining = item.key !== 'Питание';
    const expectedTrainingDay = includesTraining &&
      Math.floor(((index % 7) + 1) * profile.days / 7) >
      Math.floor((index % 7) * profile.days / 7);
    if (
      day.day !== 'День ' + (index + 1) ||
      day.trainingDay !== expectedTrainingDay ||
      typeof day.workout !== 'string' ||
      day.workout.trim().length < 15 ||
      (expectedTrainingDay && !/[0-9]+\s*(?:[×xх]\s*[0-9]+|подход(?:а|ов)?|повтор(?:а|ений)?)/i.test(day.workout)) ||
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
  const expectedTrainingDays = item.key === 'Питание' ? 0 : result.days.reduce((count, day, index) => count + (
    Math.floor(((index % 7) + 1) * profile.days / 7) > Math.floor((index % 7) * profile.days / 7) ? 1 : 0
  ), 0);
  if (trainingDays !== expectedTrainingDays) {
    throw new Error(item.key + ': expected ' + expectedTrainingDays + ' scheduled training days for ' + item.days + ' days, received ' + trainingDays + '.');
  }
  if (!Array.isArray(result.shopping) || result.shopping.length === 0 ||
      typeof result.nutritionSource !== 'string' || !result.nutritionSource.includes('USDA FoodData Central')) {
    throw new Error(item.key + ': shopping list or nutrition reference is missing.');
  }
    const summary = {
      status: 'PASS',
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
      payment: 'not created',
      durationSeconds: Math.round((Date.now() - started) / 1000)
    };
    results.push(summary);
    console.log(JSON.stringify(summary));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failure = { status: 'FAIL', plan: item.key, error: message, durationSeconds: Math.round((Date.now() - started) / 1000) };
    failures.push(failure);
    console.error(JSON.stringify(failure));
  }
}
console.log(JSON.stringify({
  status: failures.length ? 'FAIL' : 'PASS',
  results,
  failures,
  summary: `Independent AI plan validation: ${results.length} PASS, ${failures.length} FAIL.`
}));
if (failures.length) {
  throw new Error('One or more selected AI plans failed validation: ' + failures.map(item => item.plan).join(', ') + '. Each selected tariff was evaluated independently.');
}
console.log('PASS: all selected real AI plans were independently generated and validated without writing to D1 or creating payments.');
