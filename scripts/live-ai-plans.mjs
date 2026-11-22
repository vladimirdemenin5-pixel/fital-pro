const endpoint = process.env.FITALPRO_WORKER_URL || 'https://red-waterfall-2af8.vladimirdemenin5.workers.dev';
const testKey = process.env.ROBOKASSA_TEST_ACCESS_KEY;
if (!testKey) throw new Error('ROBOKASSA_TEST_ACCESS_KEY is not configured for the live integration test.');

const plans = [
  { key: 'Питание', days: 7 },
  { key: 'PRO', days: 14 },
  { key: 'Premium', days: 30 }
];

for (const item of plans) {
  const started = Date.now();
  console.log(`LIVE FLOW: starting ${item.key} (${item.days} days)`);
  const response = await fetch(endpoint + '/api/ai-data-flow-diagnostic', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Fital-Test-Key': testKey
    },
    body: JSON.stringify({ plan: item.key }),
    signal: AbortSignal.timeout(240000)
  });
  const result = await response.json().catch(() => ({}));
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
