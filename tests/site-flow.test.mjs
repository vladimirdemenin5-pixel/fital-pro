import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import workerModule from '../_worker.js';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const [worker, app, html, css, workflow, config, packageJson, oneDraftMigration] = await Promise.all([
  read('_worker.js'), read('public/app.js'), read('public/index.html'),
  read('public/styles.css'), read('.github/workflows/main.yml'),
  read('wrangler.jsonc'), read('package.json'), read('migrations/0011_one_payment_per_draft.sql'),
]);

test('tariff durations are fixed on the server', () => {
  assert.match(worker, /'Питание':\s*\{[^}]*durationDays:\s*7/);
  assert.match(worker, /'PRO':\s*\{[^}]*durationDays:\s*14/);
  assert.match(worker, /'Premium':\s*\{[^}]*durationDays:\s*30/);
  assert.match(worker, /week\.length!==durationDays/);
  assert.match(worker, /trainingIncluded:includeTraining/);
  assert.match(app, /trainingFields\)trainingFields\.hidden=code==='Питание'/);
  assert.match(app, /trainingDays\.required=code!=='Питание'/);
  assert.match(app, /trainingIncluded=plan\.trainingIncluded!==false/);
  assert.match(html, /id="trainingFields"/);
  assert.match(html, /id="planDaysLabel"/);
  assert.match(worker, /const includeTraining=planCode!=='Питание'/);
});

test('nutrition-only tariff does not require hidden training fields', () => {
  assert.match(app, /const selectedPlan=\$\('#planSelect'\)\?\.value\|\|localStorage\.getItem\('fitalpro_selected_plan'\)\|\|'PRO'/);
  assert.match(app, /if\(selectedPlan!=='Питание'\)data\.days=Number\(data\.days\)/);
  assert.match(app, /selectedPlan!=='Питание'&&\(data\.days<2\|\|data\.days>7\)/);
  assert.match(worker, /function normalizeProfile\(body,planCode='PRO'\)/);
  assert.match(worker, /const requiresTraining=planCode!=='Питание'/);
  assert.match(worker, /const invalidTraining=requiresTraining&&/);
  assert.match(worker, /normalizeProfile\(body,planCode\)/);
  assert.match(worker, /normalizeProfile\(body,PLANS\[sub\.plan\]\?sub\.plan:'Питание'\)/);
});

test('selected tariff is used to generate and bind the draft', () => {
  assert.match(worker, /generatePersonalPlan\(normalized\.profile,env,planCode\)/);
  assert.match(worker, /draftPlan\.planCode!==plan/);
  assert.match(worker, /Order plan mismatch/);
});

test('chat and progress are restricted to PRO and Premium', () => {
  assert.ok(worker.includes("!['PRO','Premium'].includes(sub.plan)"));
  assert.match(worker, /AI-помощник доступен в тарифах PRO и Premium/);
  assert.match(worker, /Отслеживание прогресса доступно в тарифах PRO и Premium/);
  assert.match(app, /syncPaidFeatures\(activePlan\)/);
  assert.match(html, /id="progressBox"/);
});

test('shopping list aggregates compatible metric units', () => {
  assert.match(worker, /const parseQuantity=value=>/);
  assert.match(worker, /current\.amount\+=parsed\.amount/);
  assert.match(worker, /if\(unit==='кг'\)\{amount\*=1000;unit='г';\}/);
  assert.match(worker, /if\(unit==='л'\)\{amount\*=1000;unit='мл';\}/);
});

test('Robokassa activation writes entitlement, profile and plan atomically', () => {
  const webhook = worker.slice(worker.indexOf('async function robokassaWebhook'), worker.indexOf('async function paymentStatus'));
  assert.match(webhook, /await env\.DB\.batch\(\[/);
  assert.match(webhook, /INSERT INTO subscriptions/);
  assert.match(webhook, /INSERT INTO profiles/);
  assert.match(webhook, /INSERT INTO weekly_plans/);
  assert.match(webhook, /UPDATE payments SET status=\?/);
});

test('one AI draft cannot create multiple active orders', () => {
  assert.ok(oneDraftMigration.includes('CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_one_checkout_per_draft'));
  assert.ok(oneDraftMigration.includes("WHERE draft_id IS NOT NULL AND status IN ('pending','succeeded')"));
  assert.match(worker, /existingOrder=.*payments WHERE draft_id/);
});

test('live payments require an explicit enable flag', () => {
  assert.match(worker, /ROBOKASSA_LIVE_ENABLED!=='1'/);
  assert.match(worker, /ROBOKASSA_LIVE_ENABLED==='1'/);
});

test('progress API validates dates and checkbox flags before writing D1', () => {
  assert.match(worker, /const parsedDate=new Date\(date\+'T00:00:00\\.000Z'\)/);
  assert.match(worker, /parsedDate\.toISOString\(\)\.slice\(0,10\)!==date/);
  assert.match(worker, /!Number\.isInteger\(completedMeal\).*!Number\.isInteger\(completedWorkout\)/);
  assert.match(worker, /!\[0,1\]\.includes\(completedMeal\).*!\[0,1\]\.includes\(completedWorkout\)/);
  assert.match(worker, /Некорректные данные прогресса/);
});

test('NodeList handlers use querySelectorAll, not querySelector', () => {
  assert.match(app, /\$\$\('#nav a'\)\.forEach/);
  assert.match(app, /\$\$\('\[data-plan\]'\)\.forEach/);
  assert.match(app, /\$\$\('\[data-question\]'\)\.forEach/);
  assert.doesNotMatch(app, /(^|[^$])\$\([^\)\n]+\)\.forEach/m);
});

test('temporary cabinet API failures do not erase a valid access token', () => {
  const cabinet = app.slice(app.indexOf('async function loadCabinet'), app.indexOf('async function loadProgress'));
  assert.match(cabinet, /if\(r\.status===401\|\|d\.subscription\?\.status==='expired'\)\{accessRejected=true/);
  assert.match(cabinet, /if\(accessRejected\)\{/);
  assert.match(cabinet, /localStorage\.removeItem\('fitalpro_access_token'\)/);
  assert.match(cabinet, /Токен доступа сохранён/);
  assert.doesNotMatch(cabinet.slice(cabinet.indexOf('}else{')), /removeItem\('fitalpro_access_token'\)/);
});

test('payment success and failure returns are handled separately', () => {
  assert.match(app, /p\.get\('payment'\)==='failed'/);
  assert.match(app, /paymentReturn\(\);loadCabinet\(\);/);
  assert.match(html, /id="paymentRetry"/);
  assert.match(html, /Вернуться к анкете и повторить попытку/);
});

test('AI menu ingredients and shopping list are rendered in preview and cabinet', () => {
  assert.match(app, /renderProgramDays\(plan,\$\('#weekPlan'\)\)/);
  assert.match(app, /renderShoppingList\(plan,\$\('#shoppingList'\)\)/);
  assert.match(app, /renderShoppingList\(pd\.plan,\$\('#memberShoppingList'\)\)/);
  assert.match(app, /Состав и количество/);
  assert.match(app, /Список покупок на всю программу/);
  assert.match(app, /if\(day\.training\)/);
  assert.match(html, /id="shoppingList"/);
  assert.match(html, /id="memberShoppingList"/);
  assert.match(css, /\.member-program-days/);
});

test('site hero uses the self-hosted photo file', () => {
  assert.match(html, /src="\/assets\/hero-lifestyle\.webp"/);
});

test('CI runs the regression suite before deploy dry-run', () => {
  assert.match(workflow, /npm test/);
  assert.match(workflow, /--dry-run/);
  assert.doesNotMatch(workflow, /wrangler deploy(?! --dry-run)/);
});

test('Preview is isolated and production payments default to disabled', async () => {
  const config = JSON.parse(await read('wrangler.jsonc'));
  const packageJson = JSON.parse(await read('package.json'));
  assert.equal(config.vars.ROBOKASSA_LIVE_ENABLED, '0');
  assert.equal(config.previews.vars.ROBOKASSA_IS_TEST, '1');
  assert.equal(config.previews.vars.ROBOKASSA_LIVE_ENABLED, '0');
  assert.equal(config.d1_databases[0].database_name, 'fital-pro-db');
  assert.equal(config.previews.d1_databases[0].database_name, 'fital-pro-preview-db');
  assert.equal(packageJson.scripts.preview, 'wrangler preview');
});


function fakeCheckoutDb(draftPlan) {
  const state = { payments: [] };
  return {
    state,
    prepare(sql) {
      const query = {
        args: [],
        bind(...args) { this.args = args; return this; },
        async first() {
          if (sql.includes('COUNT(*) AS n FROM request_log')) return { n: 0 };
          if (sql.includes('FROM plan_drafts WHERE id=?')) {
            return { id: 'draft-test', profile_json: '{}', plan_json: JSON.stringify(draftPlan), created_at: new Date().toISOString() };
          }
          if (sql.includes('FROM payments WHERE draft_id=?')) return null;
          return null;
        },
        async run() {
          if (sql.includes('INSERT INTO payments')) state.payments.push(this.args);
          return { success: true };
        }
      };
      return query;
    }
  };
}

test('health endpoint reports isolated Robokassa test readiness without enabling live payments', async () => {
  const request = new Request('https://preview.example/health');
  const unavailable = await workerModule.fetch(request, {
    DB: {}, AI: { run: async () => ({}) }, ROBOKASSA_IS_TEST: '0',
    ROBOKASSA_LIVE_ENABLED: '0', ROBOKASSA_MERCHANT_LOGIN: 'merchant',
    ROBOKASSA_PASSWORD1: 'live-pass-1', ROBOKASSA_PASSWORD2: 'live-pass-2'
  });
  const disabled = await unavailable.json();
  assert.equal(disabled.ok, true);
  assert.equal(disabled.paymentMode, 'disabled');
  assert.equal(disabled.payments, false);

  const testReadyResponse = await workerModule.fetch(request, {
    DB: {}, AI: { run: async () => ({}) }, ROBOKASSA_IS_TEST: '1',
    ROBOKASSA_LIVE_ENABLED: '0', ROBOKASSA_MERCHANT_LOGIN: 'merchant',
    ROBOKASSA_TEST_PASSWORD1: 'test-pass-1', ROBOKASSA_TEST_PASSWORD2: 'test-pass-2'
  });
  const testReady = await testReadyResponse.json();
  assert.equal(testReady.paymentMode, 'test');
  assert.equal(testReady.payments, true);
});

test('Robokassa checkout creates a signed IsTest=1 URL and stores a pending order', async () => {
  const db = fakeCheckoutDb({ planCode: 'Питание', programDays: 7 });
  const response = await workerModule.fetch(new Request('https://preview.example/api/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan: 'Питание', draft_id: 'draft-test' })
  }), {
    DB: db, ROBOKASSA_IS_TEST: '1', ROBOKASSA_LIVE_ENABLED: '0',
    ROBOKASSA_MERCHANT_LOGIN: 'merchant-test',
    ROBOKASSA_TEST_PASSWORD1: 'test-pass-1',
    ROBOKASSA_TEST_PASSWORD2: 'test-pass-2'
  });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(db.state.payments.length, 1);
  assert.equal(db.state.payments[0][1], 'pending');
  assert.equal(db.state.payments[0][2], 'Питание');
  assert.equal(db.state.payments[0][3], '990.00');

  const url = new URL(data.confirmation_url);
  assert.equal(url.hostname, 'auth.robokassa.ru');
  assert.equal(url.searchParams.get('IsTest'), '1');
  assert.equal(url.searchParams.get('OutSum'), '990.00');
  assert.equal(url.searchParams.get('Shp_plan'), 'Питание');
  assert.ok(url.searchParams.get('Shp_client_ref'));
  const shp = [...url.searchParams.entries()]
    .filter(([key]) => key.startsWith('Shp_'))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => key + '=' + value);
  const expected = createHash('md5')
    .update(['merchant-test', '990.00', url.searchParams.get('InvId'), 'test-pass-1', ...shp].join(':'))
    .digest('hex').toUpperCase();
  assert.equal(url.searchParams.get('SignatureValue'), expected);
});

test('Robokassa rejects an invalid ResultURL signature before looking up an order', async () => {
  const request = new Request('https://preview.example/webhooks/robokassa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      OutSum: '990.00', InvId: '1234567890', SignatureValue: 'not-a-valid-signature',
      Shp_client_ref: '0123456789abcdef0123456789abcdef', Shp_plan: 'Питание'
    })
  });
  const response = await workerModule.fetch(request, {
    DB: {}, ROBOKASSA_IS_TEST: '1', ROBOKASSA_TEST_PASSWORD2: 'test-pass-2'
  });
  assert.equal(response.status, 400);
  assert.equal(await response.text(), 'Invalid signature');
});
