const endpoint = process.env.FITALPRO_WORKER_URL || 'https://red-waterfall-2af8.vladimirdemenin5.workers.dev';
const testKey = process.env.FITALPRO_CI_TEST_KEY;
if (!testKey) throw new Error('Temporary Fital Pro CI diagnostic key was not created.');

const plans = [
  { key: 'Питание', days: 7 },
  { key: 'PRO', days: 14 },
  { key: 'Premium', days: 30 }
];

for (const item of plans) {
  const started = Date.now();
  console.log(`LIVE FLOW: starting ${item.key} (${item.days} days)`);
  let response;
  let result = {};
  const authPropagationDeadline = Date.now() + 90000;
  do {
    response = await fetch(endpoint + '/api/ai-data-flow-diagnostic', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Fital-Test-Key': testKey
      },
      body: JSON.stringify({ plan: item.key }),
      signal: AbortSignal.timeout(240000)
    });
    result = await response.json().catch(() => ({}));
    if (response.status !== 404 || result.error !== 'Диагностический доступ не настроен или ключ неверен.' ||
        Date.now() >= authPropagationDeadline) break;
    console.log('Temporary Worker secret is not visible yet; retrying in 5 seconds.');
    await new Promise(resolve => setTimeout(resolve, 5000));
  } while (Date.now() < authPropagationDeadline);
  if (!response.ok || result.ok !== true) {
    throw new Error(`${item.key}: live Worker flow failed (HTTP ${response.status}): ${result.error || 'unknown error'}`);
  }
  if (result.days !== item.days || result.meals !== item.days * 4 ||
      result.d1Write !== true || result.cabinetPlanRead !== true ||
      result.cabinetProfileRead !== true || result.memberAccessRead !== true) {
    throw new Error(`${item.key}: AI → D1 → personal cabinet verification returned incomplete results.`);
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
