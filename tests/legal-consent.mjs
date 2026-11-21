import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const html = read('public/index.html');
const app = read('public/app.js');
const worker = read('_worker.js');
const schema = read('migrations/0001_init.sql');

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
assert.match(schema, /client_ref TEXT NOT NULL UNIQUE/);
assert.match(schema, /payment_id TEXT NOT NULL UNIQUE/);
assert.match(schema, /access_token TEXT NOT NULL UNIQUE/);
assert.match(schema, /CREATE TABLE IF NOT EXISTS profiles/);
assert.match(schema, /CREATE TABLE IF NOT EXISTS weekly_plans/);
assert.ok(worker.includes('INSERT INTO payments'));
assert.ok(worker.includes('ON CONFLICT(payment_id) DO NOTHING'));
assert.ok(worker.includes('await saveMemberPlan(env, accessToken, profile, plan)'));
assert.ok(worker.includes("UPDATE pending_orders SET status='paid'"));
assert.ok(worker.includes('INNER JOIN profiles p'));
assert.ok(worker.includes('INNER JOIN weekly_plans w'));
assert.ok(worker.includes("if (!['PRO', 'Premium'].includes(sub.plan)) return json({ error: 'Дневник прогресса доступен на тарифах PRO и Premium.' }, 403)"));
assert.ok(worker.includes("if (!['PRO', 'Premium'].includes(sub.plan)) return json({ error: 'ИИ-консультант доступен на тарифах PRO и Premium.' }, 403)"));
assert.ok(app.includes("const advancedFeatures = ['PRO', 'Premium'].includes(subscription.plan)"));
assert.ok(app.includes("$('#progressTool').classList.toggle('is-hidden', !advancedFeatures)"));
assert.ok(app.includes("$('#chatTool').classList.toggle('is-hidden', !advancedFeatures)"));
assert.ok(html.includes('id="progressTool"'));
assert.ok(html.includes('id="chatTool"'));
assert.ok(worker.includes('trainingDay: day?.trainingDay === true'));
assert.ok(worker.includes('trainingDays !== profile.days'));
assert.ok(worker.includes("Не удалось пересобрать план. Сохранённая программа не изменена."));
assert.ok(worker.includes('Сумма trainingDay=true должна быть ровно'));
assert.ok(app.includes("day.trainingDay ? 'Тренировка' : 'Отдых и активность'"));
console.log('PASS: legal pages, required consent, server-side consent records, and protected payment-token handoff');
