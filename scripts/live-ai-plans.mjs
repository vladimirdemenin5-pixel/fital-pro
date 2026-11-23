const endpoint = process.env.FITALPRO_WORKER_URL || 'https://red-waterfall-2af8.vladimirdemenin5.workers.dev';
const oidcRequestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
const oidcRequestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
if (!oidcRequestUrl || !oidcRequestToken) {
  throw new Error('GitHub Actions OIDC is not enabled for the live integration job.');
}

async function getOidcToken() {
  const url = new URL(oidcRequestUrl);
  url.searchParams.set('audience', 'fitalpro-ai-data-flow');
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

const plans = [
  { key: 'Питание', days: 7 },
  { key: 'PRO', days: 14 },
  { key: 'Premium', days: 30 }
];

for (const item of plans) {
  const started = Date.now();
  const oidcToken = await getOidcToken();
  const oidcClaims = JSON.parse(Buffer.from(oidcToken.split('.')[1], 'base64url').toString('utf8'));
  console.log('OIDC identity:', JSON.stringify({ aud: oidcClaims.aud, sub: oidcClaims.sub, repository: oidcClaims.repository, ref: oidcClaims.ref, workflow_ref: oidcClaims.workflow_ref, event_name: oidcClaims.event_name }));
  console.log(`LIVE FLOW: starting ${item.key} (${item.days} days)`);
  let response;
  let result = {};
  const authPropagationDeadline = Date.now() + 90000;
  do {
    response = await fetch(endpoint + '/api/ai-data-flow-diagnostic', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + oidcToken
      },
      body: JSON.stringify({ plan: item.key }),
      signal: AbortSignal.timeout(Math.max(240000, item.days * 30000 + 120000))
    });
    result = await response.json().catch(() => ({}));
    if (response.status !== 404 || result.error !== 'Диагностический доступ не настроен или ключ неверен.' ||
        Date.now() >= authPropagationDeadline) break;
    console.log('GitHub OIDC authorization is not ready yet; retrying in 5 seconds.');
    await new Promise(resolve => setTimeout(resolve, 5000));
  } while (Date.now() < authPropagationDeadline);
  if (!response.ok || result.ok !== true) {
    throw new Error(`${item.key}: live Worker flow failed (HTTP ${response.status}, stage ${result.stage || 'authorization'}): ${result.error || 'unknown error'}${result.diagnostic ? ' [' + result.diagnostic + ']' : ''}`);
  }
  if (result.days !== item.days || result.meals !== item.days * 4 ||
      result.d1Write !== true || result.cabinetPlanRead !== true ||
      result.cabinetProfileRead !== true || result.memberAccessRead !== true) {
    throw new Error(`${item.key}: AI → D1 → personal-cabinet verification returned incomplete results.`);
  }
  console.log(JSON.stringify({
    plan: item.key,
    days: result.days,
    meals: result.meals,
    d1Write: 'passed',
    cabinetPlanRead: 'passed',
    cabinetProfileRead: 'passed',
    memberAccessRead: 'passed',
    dailyAverageKBZHU: result.dailyAverage,
    durationSeconds: Math.round((Date.now() - started) / 1000)
  }));
}
console.log('PASS: live AI generation, D1 persistence, and personal-cabinet reads passed for all three plans.');
