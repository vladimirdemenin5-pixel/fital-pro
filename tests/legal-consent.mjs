import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const html = read('public/index.html');
const app = read('public/app.js');
const worker = read('_worker.js');

for (const name of ['pd_consent', 'offer_accepted']) {
  assert.match(html, new RegExp('name="' + name + '"[^>]*required'));
  assert.ok(app.includes(name + ": fields.get('" + name + "') === 'on'"));
  assert.ok(worker.includes('accepted(body?.' + name + ')'));
}
for (const page of ['oferta.html', 'privacy.html', 'delivery-refund.html', 'requisites.html']) {
  const content = read('public/' + page);
  assert.match(content, /<html lang="ru">/);
  assert.match(content, /Fital Pro/);
}
assert.ok(html.includes('href="/oferta.html"'));
assert.ok(html.includes('href="/privacy.html"'));
assert.ok(worker.includes('pd_consent_at'));
assert.ok(worker.includes('pd_policy_version'));
assert.ok(worker.includes('offer_accepted_at'));
assert.ok(worker.includes('HttpOnly; Secure; SameSite=Lax'));
const cookieLine = worker.split('\n').find(line => line.includes('const checkoutCookie'));
assert.ok(cookieLine, 'payment status must parse its checkout cookie');
const cookieRegexSource = cookieLine.match(/\.match\((\/.*\/)\)\?\.\[1\]/)?.[1];
assert.ok(cookieRegexSource, 'checkout cookie matcher must be present');
const cookieRegex = new RegExp(cookieRegexSource.slice(1, cookieRegexSource.lastIndexOf('/')));
assert.equal(cookieRegex.exec('; fitalpro_checkout_ref=sample')?.[1], 'sample');
assert.ok(worker.includes('checkoutCookie !== order.client_ref'));
assert.ok(worker.includes('order.status === \'paid\' && subscription?.status === \'active\''));
assert.ok(worker.includes('INNER JOIN profiles p ON p.access_token=s.access_token'));
assert.ok(worker.includes('INNER JOIN weekly_plans w ON w.access_token=s.access_token'));
assert.ok(worker.includes('s.expires_at>?)'));
assert.ok(worker.includes("'ROBOKASSA_TEST_PASSWORD' + number"));
assert.ok(worker.includes("env.ROBOKASSA_IS_TEST === '1'"));
assert.ok(worker.includes('const password1 = robokassaPassword(env, 1)'));
assert.ok(worker.includes('const password2 = robokassaPassword(env, 2)'));
assert.ok(worker.includes('trainingDay: day?.trainingDay === true'));
assert.ok(worker.includes('trainingDays !== profile.days'));
assert.ok(worker.includes("Не удалось пересобрать план. Сохранённая программа не изменена."));
assert.ok(worker.includes('Сумма trainingDay=true должна быть ровно'));
assert.ok(app.includes("day.trainingDay ? 'Тренировка' : 'Отдых и активность'"));
console.log('PASS: legal pages, required consent, server-side consent records, and protected payment-token handoff');
