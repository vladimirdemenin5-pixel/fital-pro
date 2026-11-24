import assert from 'node:assert/strict';
import {
  robokassaWebhook,
  paymentStatus,
  robokassaResultSignature,
  testCheckout
} from '../_worker.js';
import worker from '../_worker.js';

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
    this.nextInvId = 100;
  }

  prepare(sql) {
    const db = this;
    let args = [];
    return {
      sql,
      get args() { return args; },
      bind(...values) { args = values; return this; },
      async first() {
        if (sql.includes('SELECT COUNT(*) AS n FROM request_log')) return { n: 0 };
        if (sql.startsWith('INSERT INTO pending_orders')) {
          const [client_ref, plan, amount, customer_contact, profile_json, plan_json, status, created_at, updated_at, pd_consent_at, pd_policy_version, offer_accepted_at, offer_version, is_test] = args;
          const inv_id = db.nextInvId++;
          db.orders.set(inv_id, { inv_id, client_ref, plan, amount, customer_contact, profile_json, plan_json, status, created_at, updated_at, pd_consent_at, pd_policy_version, offer_accepted_at, offer_version, is_test });
          return { inv_id };
        }
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
        if (sql.includes('SELECT * FROM subscriptions WHERE access_token=?')) {
          return [...db.subscriptions.values()].find(row => row.access_token === args[0] && row.status === 'active' && (!row.expires_at || row.expires_at > args[1])) || null;
        }
        if (sql.includes('SELECT profile_json FROM profiles WHERE access_token=?')) {
          return db.profiles.get(args[0]) || null;
        }
        if (sql.includes('SELECT plan_json FROM weekly_plans WHERE access_token=?')) {
          return db.plans.get(args[0]) || null;
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
          return { results: ['pd_consent_at','pd_policy_version','offer_accepted_at','offer_version','is_test'].map(name => ({ name })) };
        }
        return { results: [] };
      },
      async run() {
        if (sql.startsWith('INSERT INTO request_log')) return { meta: { changes: 1 } };
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
const env = { DB: new MockD1(), ROBOKASSA_IS_TEST: '0', ROBOKASSA_TEST_PASSWORD2: password2 };
const order = {
  inv_id: 42,
  client_ref: 'safe-test-order',
  plan: 'Питание',
  amount: '990.00',
  customer_contact: 'test@example.invalid',
  profile_json: JSON.stringify({ name: 'Тестовый клиент' }),
  plan_json: JSON.stringify({ plan: 'Питание', week: [{ day: 'День 1' }] }),
  status: 'pending',
  is_test: 1,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
};
env.DB.orders.set(order.inv_id, { ...order });

function callback(overrides = {}, signingPassword = password2) {
  const fields = {
    OutSum: '990.00',
    InvId: '42',
    Shp_ref: order.client_ref,
    ...overrides
  };
  fields.SignatureValue = robokassaResultSignature(fields.OutSum, fields.InvId, signingPassword, fields);
  return new Request('https://fitalpro.test/webhooks/robokassa', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields)
  });
}

async function status() {
  return paymentStatus(new Request(
    'https://fitalpro.test/api/payment-status?ref=' + order.client_ref,
    { headers: { Cookie: 'fitalpro_checkout_' + order.client_ref + '=' + order.client_ref } }
  ), env);
}

// A newer pending checkout must not overwrite authorization for this order.
const multiCookieStatus = await paymentStatus(new Request(
  'https://fitalpro.test/api/payment-status?ref=' + order.client_ref,
  { headers: { Cookie: 'fitalpro_checkout_other=other; fitalpro_checkout_' + order.client_ref + '=' + order.client_ref } }
), env);
assert.equal((await multiCookieStatus.json()).status, 'pending');
const mismatchedCookieStatus = await paymentStatus(new Request(
  'https://fitalpro.test/api/payment-status?ref=' + order.client_ref,
  { headers: { Cookie: 'fitalpro_checkout_' + order.client_ref + '=different-ref' } }
), env);
assert.equal((await mismatchedCookieStatus.json()).status, 'pending');

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
assert.ok(env.DB.payments.has('robokassa-test-42'), 'test payment must use a separate payment identifier');
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

const wrongReference = await robokassaWebhook(callback({ Shp_ref: 'different-order' }), env);
assert.equal(wrongReference.status, 400);
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
  { headers: { Cookie: 'fitalpro_checkout_' + order.client_ref + '=' + order.client_ref } }
), retryEnv);
let retryPayload = await retryResponse.json();
assert.equal(retryPayload.status, 'pending');
assert.equal(retryPayload.access_token, undefined);

retryResponse = await robokassaWebhook(callback(), retryEnv);
assert.equal(retryResponse.status, 200);
assert.equal(retryEnv.DB.orders.get(42).status, 'paid');
retryResponse = await paymentStatus(new Request(
  'https://fitalpro.test/api/payment-status?ref=' + order.client_ref,
  { headers: { Cookie: 'fitalpro_checkout_' + order.client_ref + '=' + order.client_ref } }
), retryEnv);
retryPayload = await retryResponse.json();
assert.equal(retryPayload.status, 'active');
assert.ok(retryPayload.access_token);


// Two simultaneous deliveries of the same notification must converge on the
// same unique payment/subscription rather than issuing two access tokens.
const concurrentEnv = { ...env, DB: new MockD1() };
concurrentEnv.DB.orders.set(42, { ...order });
const concurrentResults = await Promise.all([
  robokassaWebhook(callback(), concurrentEnv),
  robokassaWebhook(callback(), concurrentEnv)
]);
assert.deepEqual(concurrentResults.map(item => item.status), [200, 200]);
assert.equal(concurrentEnv.DB.payments.size, 1);
assert.equal(concurrentEnv.DB.subscriptions.size, 1);
const concurrentTokens = [...concurrentEnv.DB.subscriptions.values()].map(item => item.access_token);
assert.equal(new Set(concurrentTokens).size, 1);
const concurrentStatus = await paymentStatus(new Request(
  'https://fitalpro.test/api/payment-status?ref=' + order.client_ref,
  { headers: { Cookie: 'fitalpro_checkout_' + order.client_ref + '=' + order.client_ref } }
), concurrentEnv);
const concurrentPayload = await concurrentStatus.json();
assert.equal(concurrentPayload.status, 'active');
assert.equal(concurrentPayload.access_token, concurrentTokens[0]);

// The test-only checkout endpoint is closed unless the private access key matches.
const deniedTestCheckout = await testCheckout(new Request('https://fitalpro.test/api/checkout-test', {
  method: 'POST',
  headers: { 'X-Fital-Test-Key': 'wrong-key', 'content-type': 'application/json' },
  body: '{}'
}), { ROBOKASSA_TEST_ACCESS_KEY: 'expected-key' });
assert.equal(deniedTestCheckout.status, 404);

// Production orders continue to use Password #2 even while test credentials
// are present and the global Worker mode remains production (0).
const livePassword2 = 'live-password-2';
const liveEnv = {
  DB: new MockD1(),
  ROBOKASSA_IS_TEST: '0',
  ROBOKASSA_PASSWORD2: livePassword2,
  ROBOKASSA_TEST_PASSWORD2: password2
};
liveEnv.DB.orders.set(42, { ...order, is_test: 0 });
const liveCallback = await robokassaWebhook(callback({}, livePassword2), liveEnv);
assert.equal(liveCallback.status, 200);
assert.ok(liveEnv.DB.payments.has('robokassa-42'));
assert.equal(liveEnv.DB.payments.has('robokassa-test-42'), false);

console.log('PASS: Robokassa webhook idempotency, validation, retry and access-gating tests');

function makeCheckoutAi() {
  return {
    async run(_model, input) {
      const prompt = input?.messages?.[1]?.content || '';
      const block = prompt.match(/БЛОК: дни (\d+)–(\d+) из (\d+)/);
      const requestedDays = block ? Number(block[2]) - Number(block[1]) + 1 : 7;
      const week = Array.from({ length: requestedDays }, (_, index) => {
        const dayInWeek = index % 7;
        const trainingDay = dayInWeek === 0 || dayInWeek === 2 || dayInWeek === 4;
        return {
          day: 'День ' + (index + 1),
          trainingDay,
          breakfast: 'Овсяная каша с бананом',
          breakfastRecipe: 'Свари хлопья на молоке до мягкости и добавь нарезанный банан.',
          breakfastIngredients: [['oats_dry', 80], ['milk_2pct', 200], ['banana', 120]],
          lunch: 'Курица с рисом и брокколи',
          lunchRecipe: 'Отвари рис, запеки курицу и приготовь брокколи на пару.',
          lunchIngredients: [['chicken_raw', 100], ['rice_dry', 85], ['broccoli', 100]],
          snack: 'Йогурт с яблоком и миндалём',
          snackRecipe: 'Нарежь яблоко и подай с йогуртом и миндалём.',
          snackIngredients: [['greek_yogurt', 150], ['apple', 150], ['almonds', 15]],
          dinner: 'Лосось с картофелем и овощами',
          dinnerRecipe: 'Запеки лосось с картофелем, подай с овощами.',
          dinnerIngredients: [['salmon_raw', 100], ['potato_raw', 200], ['olive_oil', 28], ['tomato', 100], ['avocado', 50]],
          workout: trainingDay ? 'Разминка, приседания 3×10, тяга 3×10, заминка' : 'Прогулка и восстановление'
        };
      });
      return { response: JSON.stringify({ intro: 'План создан по тестовой анкете.', week, tips: ['Пейте воду по жажде.'] }) };
    }
  };
}

// End-to-end server flow: tariff/questionnaire -> preview/payment URL -> signed
// Robokassa notification -> subscription -> saved plan/profile -> cabinet APIs.
// This uses only in-memory D1, a deterministic AI fixture and test credentials;
// it never sends a payment to Robokassa or touches production settings.
const flowDb = new MockD1();
const flowEnv = {
  DB: flowDb,
  AI: makeCheckoutAi(),
  ROBOKASSA_IS_TEST: '0',
  ROBOKASSA_MERCHANT_LOGIN: 'fitalpro-test',
  ROBOKASSA_TEST_PASSWORD1: 'flow-test-password-1',
  ROBOKASSA_TEST_PASSWORD2: 'flow-test-password-2',
  ROBOKASSA_TEST_ACCESS_KEY: 'flow-test-access-key'
};
const flowProfile = {
  name: 'Тестовый клиент',
  sex: 'female',
  age: 30,
  height: 170,
  weight: 70,
  activity: 'medium',
  goal: 'maintenance',
  training: 'mixed',
  days: 3,
  preferences: 'Без ограничений'
};
// Regression: when generative AI is unavailable, checkout must refuse to
// create an order or payment URL rather than sell a catalog fallback as AI.
const quotaDb = new MockD1();
const quotaEnv = {
  ...flowEnv,
  DB: quotaDb,
  AI: {
    async run() {
      throw new Error('4006: you have used up your daily free allocation of 10,000 neurons');
    }
  }
};
const quotaCheckoutResponse = await worker.fetch(new Request('https://fitalpro.test/api/checkout-test', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'X-Fital-Test-Key': quotaEnv.ROBOKASSA_TEST_ACCESS_KEY
  },
  body: JSON.stringify({
    plan: 'Питание',
    contact: 'quota-test@example.invalid',
    profile: flowProfile,
    pd_consent: true,
    offer_accepted: true
  })
}), quotaEnv);
assert.equal(quotaCheckoutResponse.status, 503,
  'daily Cloudflare AI quota exhaustion must block checkout before creating payment');
const quotaCheckoutPayload = await quotaCheckoutResponse.json();
assert.equal(quotaCheckoutPayload.ok, undefined);
assert.match(quotaCheckoutPayload.error, /ИИ временно недоступен|ИИ.*недоступен/i);
assert.equal(quotaDb.orders.size, 0, 'no pending order or Robokassa payment may be created without a generative AI plan');

const checkoutResponse = await worker.fetch(new Request('https://fitalpro.test/api/checkout-test', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'X-Fital-Test-Key': flowEnv.ROBOKASSA_TEST_ACCESS_KEY
  },
  body: JSON.stringify({
    plan: 'Питание',
    contact: 'flow-test@example.invalid',
    profile: flowProfile,
    pd_consent: true,
    offer_accepted: true
  })
}), flowEnv);
assert.equal(checkoutResponse.status, 200, 'a valid questionnaire must produce a checkout response');
const checkoutPayload = await checkoutResponse.json();
assert.equal(checkoutPayload.ok, true);
assert.equal(checkoutPayload.preview.firstDay.day, 'День 1');
assert.equal(checkoutPayload.preview.firstDay.breakfastIngredients.length > 0, true);
assert.equal(checkoutPayload.week, undefined, 'the full paid plan must not be returned before payment');
const checkoutCookie = (checkoutResponse.headers.get('set-cookie') || '').split(';')[0];
assert.match(checkoutCookie, /^fitalpro_checkout_[a-f0-9]+=[a-f0-9]+$/);
const paymentUrl = new URL(checkoutPayload.confirmation_url);
const invId = paymentUrl.searchParams.get('InvId');
const clientRef = paymentUrl.searchParams.get('Shp_ref');
assert.ok(invId && clientRef, 'checkout must retain the order ID and private client reference in the payment link');

const lockedPlanResponse = await worker.fetch(new Request('https://fitalpro.test/api/plan'), flowEnv);
assert.equal(lockedPlanResponse.status, 403, 'full plan must remain locked before the payment notification');

const flowFields = {
  OutSum: checkoutPayload.amount,
  InvId: invId,
  Shp_ref: clientRef
};
flowFields.SignatureValue = robokassaResultSignature(
  flowFields.OutSum, flowFields.InvId, flowEnv.ROBOKASSA_TEST_PASSWORD2, flowFields
);
const flowWebhook = await worker.fetch(new Request('https://fitalpro.test/webhooks/robokassa', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(flowFields)
}), flowEnv);
assert.equal(flowWebhook.status, 200, 'a valid signed payment notification must activate the order');
assert.equal(await flowWebhook.text(), 'OK' + invId);

const flowStatusResponse = await worker.fetch(new Request(
  'https://fitalpro.test/api/payment-status?ref=' + encodeURIComponent(clientRef),
  { headers: { Cookie: checkoutCookie } }
), flowEnv);
assert.equal(flowStatusResponse.status, 200);
const flowStatus = await flowStatusResponse.json();
assert.equal(flowStatus.status, 'active');
assert.ok(flowStatus.access_token, 'payment confirmation must release the access token');

const authorization = { Authorization: 'Bearer ' + flowStatus.access_token };
const [cabinetResponse, planResponse, profileResponse] = await Promise.all([
  worker.fetch(new Request('https://fitalpro.test/api/me', { headers: authorization }), flowEnv),
  worker.fetch(new Request('https://fitalpro.test/api/plan', { headers: authorization }), flowEnv),
  worker.fetch(new Request('https://fitalpro.test/api/profile', { headers: authorization }), flowEnv)
]);
assert.equal(cabinetResponse.status, 200);
assert.equal(planResponse.status, 200);
assert.equal(profileResponse.status, 200);
const [cabinet, savedPlan, savedProfile] = await Promise.all([
  cabinetResponse.json(), planResponse.json(), profileResponse.json()
]);
assert.equal(cabinet.subscription.plan, 'Питание');
assert.equal(cabinet.subscription.status, 'active');
assert.equal(savedPlan.plan.week.length, 7);
assert.equal(savedPlan.plan.week[0].day, 'День 1');
assert.equal(savedProfile.profile.name, flowProfile.name);

console.log('PASS: full test checkout -> signed payment -> active access -> personal cabinet flow');

