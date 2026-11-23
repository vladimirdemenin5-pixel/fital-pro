import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

const endpoint = process.env.FITALPRO_WORKER_URL || 'http://127.0.0.1:8787';

function postJson(url, body, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    const requestClient = new URL(url).protocol === 'https:' ? httpsRequest : httpRequest;
    const request = requestClient(url, { method: 'POST', headers }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => {
        let data = {};
        try { data = JSON.parse(text); } catch {}
        const status = response.statusCode || 0;
        resolve({ ok: status >= 200 && status < 300, status, json: async () => data });
      });
    });
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error('Cloudflare preview did not respond within ' + timeoutMs + ' ms.'));
    });
    request.on('error', reject);
    request.write(JSON.stringify(body));
    request.end();
  });
}
const oidcRequestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
const oidcRequestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
if (!oidcRequestUrl || !oidcRequestToken) {
  throw new Error('GitHub Actions OIDC is not enabled for the preview AI generation job.');
}

const expectedClaims = {
  aud: 'fitalpro-ai-data-flow',
  repository: 'vladimirdemenin5-pixel/fital-pro',
  ref: 'refs/pull/53/merge',
  workflow_ref: 'vladimirdemenin5-pixel/fital-pro/.github/workflows/pull-request-checks.yml@refs/pull/53/merge',
  event_name: 'pull_request',
  head_ref: 'design/tilda-inspired-bold-redesign',
  base_ref: 'main',
  sub: [
    'repo:vladimirdemenin5-pixel/fital-pro:pull_request',
    'repo:vladimirdemenin5-pixel@324070911/fital-pro@1354815283:pull_request'
  ]
};

async function getOidcToken() {
  const url = new URL(oidcRequestUrl);
  url.searchParams.set('audience', expectedClaims.aud);
  const response = await fetch(url, {
    headers: { Authorization: 'Bearer ' + oidcRequestToken },
    signal: AbortSignal.timeout(30000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.value) {
    throw new Error('Could not obtain the GitHub Actions OIDC identity token.');
  }
  return result.value;
}

function readClaims(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('GitHub Actions returned an invalid OIDC token.');
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
}

function assertValidNutrition(nutrition, targets, label) {
  const ranges = {
    calories: 0.2,
    protein: 0.2,
    fat: 0.3,
    carbs: 0.3
  };
  for (const [key, tolerance] of Object.entries(ranges)) {
    const value = Number(nutrition?.[key]);
    const target = Number(targets?.[key]);
    if (!Number.isFinite(value) || !Number.isFinite(target) || target <= 0 ||
        value < target * (1 - tolerance) || value > target * (1 + tolerance)) {
      throw new Error(label + ': ' + key + ' is outside the server validation range.');
    }
  }
}

const profile = {
  name: 'Тестовый клиент Fital Pro',
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
  { key: 'PRO', days: 14 },
  { key: 'Premium', days: 30 }
];

for (const item of plans) {
  const started = Date.now();
  const oidcToken = await getOidcToken();
  const claims = readClaims(oidcToken);
  for (const [key, expected] of Object.entries(expectedClaims)) {
    const actual = claims[key];
    const allowed = Array.isArray(expected) ? expected : [expected];
    if (!allowed.includes(actual)) {
      throw new Error('OIDC claim ' + key + ' does not match the restricted preview workflow.');
    }
  }

  console.log('LIVE PREVIEW AI: starting ' + item.key + ' (' + item.days + ' days).');
  const response = await postJson(
    endpoint + '/api/ai-diagnostic',
    { plan: item.key, profile },
    {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + oidcToken
    },
    40 * 60 * 1000
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok !== true) {
    throw new Error(item.key + ': preview AI generation failed (HTTP ' + response.status + '): ' +
      (result.error || 'unknown error') + (result.diagnostic ? ' [' + result.diagnostic + ']' : ''));
  }
  if (result.plan !== item.key || result.menuDays !== item.days ||
      result.durationDays !== item.days || !Array.isArray(result.days) ||
      result.days.length !== item.days) {
    throw new Error(item.key + ': AI response does not contain the exact requested plan duration.');
  }

  const mealKeys = ['breakfast', 'lunch', 'snack', 'dinner'];
  for (let i = 0; i < result.days.length; i++) {
    const day = result.days[i];
    if (day.day !== 'День ' + (i + 1)) {
      throw new Error(item.key + ': missing or reordered day ' + (i + 1) + '.');
    }
    if (!day.meals || mealKeys.some(key => {
      const meal = day.meals[key];
      return !meal || typeof meal.title !== 'string' || !meal.title.trim() ||
        typeof meal.recipe !== 'string' || meal.recipe.trim().length < 15 ||
        meal.recipe.trim().length > 300 ||
        !Array.isArray(meal.ingredients) || meal.ingredients.length < 1 ||
        meal.ingredients.length > 6 ||
        meal.ingredients.some(ingredient =>
          typeof ingredient.foodId !== 'string' ||
          !Number.isInteger(ingredient.grams) ||
          ingredient.grams < 5 || ingredient.grams > 500
        );
    })) {
      throw new Error(item.key + ': invalid meal, recipe, or ingredient in day ' + (i + 1) + '.');
    }
    assertValidNutrition(day.calculatedNutrition, result.targets, item.key + ' day ' + (i + 1));
  }

  for (const key of ['calories', 'protein', 'fat', 'carbs']) {
    if (!Number.isFinite(Number(result.dailyAverage?.[key]))) {
      throw new Error(item.key + ': daily-average nutrition is incomplete.');
    }
  }
  if (!Array.isArray(result.shopping) || result.shopping.length === 0 ||
      typeof result.nutritionSource !== 'string' || !result.nutritionSource.includes('USDA FoodData Central')) {
    throw new Error(item.key + ': shopping list or nutrition source is missing.');
  }

  console.log(JSON.stringify({
    status: 'PASS',
    plan: item.key,
    days: result.days.length,
    meals: result.days.length * mealKeys.length,
    everyDayNutritionValidated: true,
    recipesAndIngredientsValidated: true,
    shoppingList: result.shopping.length,
    dailyAverage: result.dailyAverage,
    durationSeconds: Math.round((Date.now() - started) / 1000)
  }));
}

console.log('PASS: real Cloudflare Workers AI generated and server-validated both 14-day and 30-day plans in an isolated remote preview. No checkout or D1 writes were performed.');
