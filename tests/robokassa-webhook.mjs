import assert from 'node:assert/strict';
import {
  robokassaWebhook,
  paymentStatus,
  robokassaResultSignature
} from '../_worker.js';

// Minimal in-memory D1 double. It implements only the SQL used by the real
// webhook, saveMemberPlan and paymentStatus handlers; no network or credentials.
class MockD1 {
  constructor() {
    this.orders = new Map();
    this.payments = new Map();
    this.subscriptions = new Map();
    this.profiles = new Map();
    this.plans = new Map();
    this.failNextBatch = false;
    this.batchCalls = 0;
  }

  prepare(sql) {
    const db = this;
    let args = [];
    return {
      sql,
      get args() { return args; },
      bind(...values) { args = values; return this; },
      async first() {
        if (sql.includes('FROM pending_orders WHERE inv_id=?')) return db.orders.get(Number(args[0])) || null;
        if (sql.includes('FROM pending_orders WHERE client_ref=?')) {
          return [...db.orders.values()].find(row => row.client_ref === args[0]) || null;
        }
        if (sql.includes('FROM subscriptions WHERE payment_id=?')) {
          return [...db.subscriptions.values()].find(row => row.payment_id === args[0]) || null;
        }
        if (sql.includes('SELECT id FROM weekly_plans WHERE access_token=?')) {
          return db.plans.has(args[0]) ? { id: args[0] } : null;
        }
        if (sql.includes('INNER JOIN profiles') && sql.includes('INNER JOIN weekly_plans')) {
          const sub = [...db.subscriptions.values()].find(row =>
            row.client_ref === args[0] && row.status === 'active' &&
            (!row.expires_at || row.expires_at > args[1])
          );
          return sub && db.profiles.has(sub.access_token) && db.plans.has(sub.access_token)
            ? { plan: sub.plan, status: sub.status, access_token: sub.access_token, updated_at: sub.updated_at, expires_at: sub.expires_at }
            : null;
        }
        return null;
      },
      async all() {
        if (sql.includes('PRAGMA table_info(pending_orders)')) {
          return { results: ['pd_consent_at','pd_policy_version','offer_accepted_at','offer_version'].map(name => ({ name })) };
        }
        return { results: [] };
      },
      async run() {
        if (sql.startsWith('CREATE TABLE') || sql.startsWith('CREATE INDEX') || sql.startsWith('ALTER TABLE')) {
          return { meta: { changes: 0 } };
        }
        if (sql.startsWith('INSERT INTO payments')) {
          db.payments.set(args[0], { id: args[0], status: args[1], plan: args[2], amount: args[3] });
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith('INSERT INTO subscriptions')) {
          const [id,payment_id,client_ref,plan,status,access_token,customer_contact,created_at,updated_at,expires_at] = args;
          if (![...db.subscriptions.values()].some(row => row.payment_id === payment_id || row.client_ref === client_ref)) {
            db.subscriptions.set(id, { id,payment_id,client_ref,plan,status,access_token,customer_contact,created_at,updated_at,expires_at });
          }
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith("UPDATE pending_orders SET status='paid'")) {
          const row = db.orders.get(Number(args[1]));
          if (row) { row.status = 'paid'; row.updated_at = args[0]; }
          return { meta: { changes: row ? 1 : 0 } };
        }
        return { meta: { changes: 0 } };
      }
    };
  }

  async batch(statements) {
    this.batchCalls++;
    if (this.failNextBatch) {
      this.failNextBatch = false;
      throw new Error('simulated D1 batch failure');
    }
    for (const statement of statements) {
      const sql = statement.sql;
      const args = statement.args;
      if (sql.startsWith('INSERT INTO profiles')) {
        this.profiles.set(args[0], { access_token: args[0], profile_json: args[1] });
      } else if (sql.startsWith('INSERT INTO weekly_plans')) {
        this.plans.set(args[1], { id: args[0], access_token: args[1], plan_json: args[2] });
      } else if (sql.startsWith('UPDATE weekly_plans')) {
        const row = this.plans.get(args[2]);
        if (row) row.plan_json = args[0];
      }
    }
    return [];
  }
}

const password2 = 'test-password-2';
const env = { DB: new MockD1(), ROBOKASSA_IS_TEST: '1', ROBOKASSA_TEST_PASSWORD2: password2 };
const order = {
  inv_id: 42,
  client_ref: 'safe-test-order',
  plan: 'Питание',
  amount: '990.00',
  customer_contact: 'test@example.invalid',
  profile_json: JSON.stringify({ name: 'Тестовый клиент' }),
  plan_json: JSON.stringify({ plan: 'Питание', week: [{ day: 'День 1' }] }),
  status: 'pending',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
};
env.DB.orders.set(order.inv_id, { ...order });

function callback(overrides = {}) {
  const fields = {
    OutSum: '990.00',
    InvId: '42',
    Shp_ref: order.client_ref,
    ...overrides
  };
  fields.SignatureValue = robokassaResultSignature(fields.OutSum, fields.InvId, password2, fields);
  return new Request('https://fitalpro.test/webhooks/robokassa', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields)
  });
}

async function status() {
  return paymentStatus(new Request(
    'https://fitalpro.test/api/payment-status?ref=' + order.client_ref,
    { headers: { Cookie: 'fitalpro_checkout_ref=' + order.client_ref } }
  ), env);
}

// Before a confirmed callback, there must be no access token.
let response = await status();
let payload = await response.json();
assert.equal(payload.status, 'pending');
assert.equal(payload.access_token, undefined);

response = await robokassaWebhook(callback(), env);
assert.equal(response.status, 200);
assert.equal(await response.text(), 'OK42');
assert.equal(env.DB.orders.get(42).status, 'paid');
assert.equal(env.DB.payments.size, 1);
assert.equal(env.DB.subscriptions.size, 1);
assert.equal(env.DB.profiles.size, 1);
assert.equal(env.DB.plans.size, 1);

response = await status();
payload = await response.json();
assert.equal(payload.status, 'active');
assert.ok(payload.access_token, 'access token is released only after profile and plan are stored');
const originalToken = payload.access_token;

// Replaying the same signed ResultURL must be idempotent: one payment,
// one subscription, same token, no duplicate profile/plan rows.
response = await robokassaWebhook(callback(), env);
assert.equal(response.status, 200);
assert.equal(await response.text(), 'OK42');
assert.equal(env.DB.payments.size, 1);
assert.equal(env.DB.subscriptions.size, 1);
response = await status();
payload = await response.json();
assert.equal(payload.access_token, originalToken);

// Wrong signature and wrong amount must not write payment/subscription/access.
const beforePayments = env.DB.payments.size;
const beforeSubs = env.DB.subscriptions.size;
const badSignature = new Request('https://fitalpro.test/webhooks/robokassa', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ OutSum: '990.00', InvId: '42', Shp_ref: order.client_ref, SignatureValue: 'BAD' })
});
response = await robokassaWebhook(badSignature, env);
assert.equal(response.status, 403);
assert.equal(env.DB.payments.size, beforePayments);
assert.equal(env.DB.subscriptions.size, beforeSubs);

const wrongAmount = await robokassaWebhook(callback({ OutSum: '1.00' }), env);
assert.equal(wrongAmount.status, 400);
assert.equal(env.DB.payments.size, beforePayments);
assert.equal(env.DB.subscriptions.size, beforeSubs);

// A storage failure after payment notification must not mark the order paid
// or release access. Retrying the same notification must finish activation.
const retryEnv = { ...env, DB: new MockD1() };
retryEnv.DB.orders.set(42, { ...order });
retryEnv.DB.failNextBatch = true;
await assert.rejects(() => robokassaWebhook(callback(), retryEnv), /simulated D1 batch failure/);
assert.equal(retryEnv.DB.orders.get(42).status, 'pending');
let retryResponse = await paymentStatus(new Request(
  'https://fitalpro.test/api/payment-status?ref=' + order.client_ref,
  { headers: { Cookie: 'fitalpro_checkout_ref=' + order.client_ref } }
), retryEnv);
let retryPayload = await retryResponse.json();
assert.equal(retryPayload.status, 'pending');
assert.equal(retryPayload.access_token, undefined);

retryResponse = await robokassaWebhook(callback(), retryEnv);
assert.equal(retryResponse.status, 200);
assert.equal(retryEnv.DB.orders.get(42).status, 'paid');
retryResponse = await paymentStatus(new Request(
  'https://fitalpro.test/api/payment-status?ref=' + order.client_ref,
  { headers: { Cookie: 'fitalpro_checkout_ref=' + order.client_ref } }
), retryEnv);
retryPayload = await retryResponse.json();
assert.equal(retryPayload.status, 'active');
assert.ok(retryPayload.access_token);

console.log('PASS: Robokassa webhook idempotency, validation, retry and access-gating tests');
