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
assert.ok(worker.includes('checkoutCookie !== order.client_ref'));
console.log('PASS: legal pages, required consent, server-side consent records, and protected payment-token handoff');
