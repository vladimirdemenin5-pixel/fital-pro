import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import workerModule from '../_worker.js';
import { verifyPreviewMigrationConfig, verifyMigrationSequence } from '../scripts/verify-preview-db.mjs';

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
  assert.match(app, /trainingFields\)trainingFields\.hidden=!selected\|\|selected==='Питание'/);
  assert.match(app, /trainingDays\)trainingDays\.required=!!selected&&selected!=='Питание'/);
  assert.match(app, /trainingIncluded=plan\.trainingIncluded!==false/);
  assert.match(html, /id="trainingFields"/);
  assert.match(html, /id="planDaysLabel"/);
  assert.match(worker, /const includeTraining=planCode!=='Питание'/);
});

test('nutrition-only tariff does not require hidden training fields', () => {
  assert.match(app, /const selectedPlan=\$\('#planSelect'\)\?\.value\|\|localStorage\.getItem\('fitalpro_selected_plan'\)\|\|''/);
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
  assert.match(worker, /const parsedDate=new Date\(date\+'T00:00:00\.000Z'\)/);
  assert.match(worker, /parsedDate\.toISOString\(\)\.slice\(0,10\)!==date/);
  assert.match(worker, /!Number\.isInteger\(completedMeal\).*!Number\.isInteger\(completedWorkout\)/);
  assert.match(worker, /!\[0,1\]\.includes\(completedMeal\).*!\[0,1\]\.includes\(completedWorkout\)/);
  assert.match(worker, /Некорректные данные прогресса/);
});


test('visitor must choose a tariff before submitting the questionnaire', () => {
  assert.match(app, /if\(localStorage\.getItem\('fitalpro_tariff_flow_version'\)!=='3'\)/);
  assert.match(app, /submit\)submit\.disabled=!selected/);
  assert.match(html, /id="planSubmit" disabled/);
  assert.match(html, /id="planSelect" disabled/);
  assert.match(html, /id="formStep">ШАГ 2 \/ 3/);
  assert.match(html, /data-plan="Питание" aria-pressed="false"/);
  assert.match(css, /\.plan-card\.is-selected/);
});

test('changing tariff or questionnaire invalidates an old preview and locks checkout until regeneration', () => {
  assert.match(app, /function clearPlanPreview\(\)/);
  assert.match(app, /if\(previous!==selected\)clearPlanPreview\(\)/);
  assert.match(app, /if\(!paid\)clearPlanPreview\(\)/);
  assert.match(app, /checkoutButton\)checkoutButton\.disabled=true/);
  assert.match(app, /checkoutButton\)checkoutButton\.disabled=false/);
  assert.match(app, /ШАГ 3 \/ 3/);
  assert.match(html, /id="checkoutButton" type="button" disabled/);
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

test('CI runs regression tests and a dry-run only, never remote migrations or production deploy', () => {
  assert.match(workflow, /npm test/);
  assert.match(workflow, /--dry-run/);
  assert.doesNotMatch(workflow, /wrangler deploy(?! --dry-run)/);
  assert.doesNotMatch(workflow, /db:migrate:preview|d1 migrations apply .*--remote/);
  assert.doesNotMatch(workflow, /npm run db:migrate(?!:local)/);
});

test('Preview bindings and migrations are isolated from Production', async () => {
  const config = JSON.parse(await read('wrangler.jsonc'));
  const previewMigrationConfig = JSON.parse(await read('wrangler.preview-migrations.jsonc'));
  const packageJson = JSON.parse(await read('package.json'));
  assert.equal(config.vars.ROBOKASSA_LIVE_ENABLED, '0');
  assert.equal(config.previews.vars.ROBOKASSA_IS_TEST, '1');
  assert.equal(config.previews.vars.ROBOKASSA_LIVE_ENABLED, '0');
  assert.equal(config.d1_databases[0].database_name, 'fital-pro-db');
  assert.equal(config.previews.d1_databases[0].database_name, 'fital-pro-preview-db');
  assert.equal(previewMigrationConfig.d1_databases[0].binding, 'PREVIEW_DB');
  assert.equal(previewMigrationConfig.d1_databases[0].database_name, 'fital-pro-preview-db');
  assert.equal(previewMigrationConfig.d1_databases[0].database_id, config.previews.d1_databases[0].database_id);
  assert.equal(packageJson.scripts.preview, 'wrangler preview');
  assert.equal(packageJson.scripts.build, 'npm run check && npm test');
  assert.equal(packageJson.scripts['db:migrate:preview'], 'node scripts/verify-preview-db.mjs && wrangler d1 migrations apply fital-pro-preview-db --remote --config wrangler.preview-migrations.jsonc');
  assert.equal(packageJson.scripts['db:migrations:list:preview'], 'node scripts/verify-preview-db.mjs && wrangler d1 migrations list fital-pro-preview-db --remote --config wrangler.preview-migrations.jsonc');
  const verifiedTarget = verifyPreviewMigrationConfig(config, previewMigrationConfig);
  assert.equal(verifiedTarget.database_name, 'fital-pro-preview-db');
  assert.equal(verifiedTarget.database_id, config.previews.d1_databases[0].database_id);
  assert.equal(verifiedTarget.database_id, '54bd4cbb-f267-4c1e-af16-cdc9b24953c1');
  assert.throws(() => verifyPreviewMigrationConfig(config, {
    d1_databases: [{ binding: 'PREVIEW_DB', database_name: 'fital-pro-preview-db', database_id: '00000000-0000-0000-0000-000000000000', migrations_dir: 'migrations' }]
  }), /verified existing Preview database/);
  assert.throws(() => verifyPreviewMigrationConfig(config, {
    d1_databases: [{ binding: 'PREVIEW_DB', database_name: config.d1_databases[0].database_name, database_id: config.d1_databases[0].database_id, migrations_dir: 'migrations' }]
  }), /fital-pro-preview-db|Production/);
  assert.equal(verifyMigrationSequence(['0001_init.sql','0002_service.sql','0003_profile.sql','0004_weekly.sql','0005_progress.sql','0006_expiry.sql','0007_checkout_sessions.sql','0008_consent.sql','0009_plan_drafts.sql','0010_plan_draft_consent.sql','0011_one_payment_per_draft.sql']).length, 11);
  assert.throws(() => verifyMigrationSequence(['0001_init.sql','0003_skipped.sql']), /gap or duplicate/);
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


function fakePlanPreviewDb() {
  const state = { drafts: [], rateLimitWrites: 0 };
  return {
    state,
    prepare(sql) {
      const query = {
        args: [],
        bind(...args) { this.args = args; return this; },
        async first() {
          if (sql.includes('COUNT(*) AS n FROM request_log')) return { n: 0 };
          return null;
        },
        async run() {
          if (sql.includes('INSERT INTO request_log')) state.rateLimitWrites += 1;
          if (sql.includes('INSERT INTO plan_drafts')) state.drafts.push(this.args);
          return { success: true };
        }
      };
      return query;
    }
  };
}

function fakeAiForPlanPreview() {
  const calls = [];
  return {
    calls,
    async run(model, options) {
      calls.push({ model, options });
      const range = options.prompt.match(/дни (\d+)–(\d+)/);
      assert.ok(range, 'AI prompt must specify an exact day range');
      const start = Number(range[1]), end = Number(range[2]);
      const types = ['breakfast', 'lunch', 'snack', 'dinner'];
      const week = [];
      for (let day = start; day <= end; day += 1) {
        week.push({
          day,
          training: options.prompt.includes('training: конкретная тренировка') ? 'Силовая тренировка: приседания 3×10, отжимания 3×8' : '',
          meals: types.map((type, index) => ({
            type,
            name: 'Блюдо ' + day + ' ' + type,
            kcal: [400, 550, 200, 500][index],
            protein: [25, 40, 15, 35][index],
            ingredients: [['овсянка', '60 г'], ['курица', '150 г']]
          }))
        });
      }
      return { response: JSON.stringify({ week }) };
    }
  };
}

test('questionnaire API generates the exact tariff duration and persists the AI draft in Preview D1', async () => {
  for (const [plan, expectedDays, trainingIncluded] of [['Питание', 7, false], ['PRO', 14, true], ['Premium', 30, true]]) {
    const DB = fakePlanPreviewDb();
    const AI = fakeAiForPlanPreview();
    const body = {
      pd_consent: 'on', name: 'Тест', sex: 'male', age: 30, height: 180, weight: 80,
      activity: 'medium', goal: 'maintain', plan,
      ...(trainingIncluded ? { training: 'home', days: 3 } : {})
    };
    const response = await workerModule.fetch(new Request('https://preview.example/api/plan-preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }), { DB, AI });
    const result = await response.json();
    assert.equal(response.status, 200, plan + ' should return a generated plan');
    assert.equal(result.ok, true);
    assert.equal(result.plan.planCode, plan);
    assert.equal(result.plan.programDays, expectedDays);
    assert.equal(result.plan.week.length, expectedDays);
    assert.equal(result.plan.trainingIncluded, trainingIncluded);
    assert.equal(AI.calls.length, Math.ceil(expectedDays / 7));
    assert.equal(DB.state.drafts.length, 1);
    const saved = JSON.parse(DB.state.drafts[0][2]);
    assert.equal(saved.planCode, plan);
    assert.equal(saved.week.length, expectedDays);
  }
});


test('questionnaire API does not save an incomplete AI response as a usable plan', async () => {
  const DB = fakePlanPreviewDb();
  let aiCalls = 0;
  const response = await workerModule.fetch(new Request('https://preview.example/api/plan-preview', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pd_consent: 'on', name: 'Тест', sex: 'male', age: 30, height: 180, weight: 80,
      activity: 'medium', goal: 'maintain', plan: 'Питание'
    })
  }), { DB, AI: { async run() { aiCalls += 1; return { response: '{"week":[' }; } } });
  const result = await response.json();
  assert.equal(response.status, 502);
  assert.match(result.error, /AI/);
  assert.equal(aiCalls, 1);
  assert.equal(DB.state.drafts.length, 0);
});

test('questionnaire API returns a clear 503 when Preview D1 migrations are missing and does not call AI', async () => {
  let aiCalls = 0;
  const DB = { prepare() { return { bind() { return this; }, async first() { throw new Error('no such table: request_log'); } }; } };
  const response = await workerModule.fetch(new Request('https://preview.example/api/plan-preview', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pd_consent: 'on', plan: 'Питание' })
  }), { DB, AI: { async run() { aiCalls += 1; return {}; } } });
  const result = await response.json();
  assert.equal(response.status, 503);
  assert.match(result.error, /Preview не готова/);
  assert.equal(aiCalls, 0);
});

test('health endpoint checks Preview D1 schema and test-payment readiness without enabling live payments', async () => {
  const request = new Request('https://preview.example/health');
  const readyDb = { prepare() { return { async first() { return null; } }; } };
  const unavailable = await workerModule.fetch(request, {
    DB: readyDb, AI: { run: async () => ({}) }, ROBOKASSA_IS_TEST: '0',
    ROBOKASSA_LIVE_ENABLED: '0', ROBOKASSA_MERCHANT_LOGIN: 'merchant',
    ROBOKASSA_PASSWORD1: 'live-pass-1', ROBOKASSA_PASSWORD2: 'live-pass-2'
  });
  const disabled = await unavailable.json();
  assert.equal(disabled.ok, true);
  assert.equal(disabled.db, true);
  assert.equal(disabled.paymentMode, 'disabled');
  assert.equal(disabled.payments, false);

  const testReadyResponse = await workerModule.fetch(request, {
    DB: readyDb, AI: { run: async () => ({}) }, ROBOKASSA_IS_TEST: '1',
    ROBOKASSA_LIVE_ENABLED: '0', ROBOKASSA_MERCHANT_LOGIN: 'merchant',
    ROBOKASSA_TEST_PASSWORD1: 'test-pass-1', ROBOKASSA_TEST_PASSWORD2: 'test-pass-2'
  });
  const testReady = await testReadyResponse.json();
  assert.equal(testReady.db, true);
  assert.equal(testReady.paymentMode, 'test');
  assert.equal(testReady.payments, true);

  const schemaNotReadyResponse = await workerModule.fetch(request, {
    DB: { prepare() { return { async first() { throw new Error('no such table'); } }; } },
    AI: { run: async () => ({}) }, ROBOKASSA_IS_TEST: '1',
    ROBOKASSA_MERCHANT_LOGIN: 'merchant',
    ROBOKASSA_TEST_PASSWORD1: 'test-pass-1', ROBOKASSA_TEST_PASSWORD2: 'test-pass-2'
  });
  const schemaNotReady = await schemaNotReadyResponse.json();
  assert.equal(schemaNotReady.db, false);
  assert.equal(schemaNotReady.payments, false);
  assert.equal(schemaNotReady.paymentMode, 'disabled');
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


test('Robokassa accepts the correctly signed test ResultURL envelope before order lookup', async () => {
  const fields = {
    OutSum: '990.00', InvId: '1234567890',
    Shp_client_ref: '0123456789abcdef0123456789abcdef',
    Shp_plan: 'Питание'
  };
  const shp = Object.keys(fields).filter(key => key.startsWith('Shp_')).sort().map(key => key + '=' + fields[key]);
  fields.SignatureValue = createHash('md5')
    .update([fields.OutSum, fields.InvId, 'test-pass-2', ...shp].join(':'))
    .digest('hex');
  const queries = [];
  const request = new Request('https://preview.example/webhooks/robokassa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields)
  });
  const response = await workerModule.fetch(request, {
    DB: { prepare(sql) { queries.push(sql); return { bind() { return this; }, async first() { return null; } }; } },
    ROBOKASSA_IS_TEST: '1', ROBOKASSA_TEST_PASSWORD2: 'test-pass-2'
  });
  assert.equal(response.status, 404);
  assert.equal(await response.text(), 'Unknown order');
  assert.ok(queries.some(sql => sql.includes('FROM payments WHERE id=?')));
});


function fakeWebhookDb({ invoiceId, clientRef, plan, amount, draftId, profile, planData }) {
  const state = { batchStatements: [] };
  return {
    state,
    prepare(sql) {
      const query = {
        sql,
        args: [],
        bind(...args) { this.args = args; return this; },
        async first() {
          if (sql.includes('FROM payments WHERE id=?')) {
            return { id: invoiceId, status: 'pending', plan, amount, currency: 'RUB', client_ref: clientRef, draft_id: draftId };
          }
          if (sql.includes('FROM plan_drafts WHERE id=?')) {
            return { profile_json: JSON.stringify(profile), plan_json: JSON.stringify(planData) };
          }
          if (sql.includes('FROM subscriptions WHERE payment_id=?')) return null;
          return null;
        }
      };
      return query;
    },
    async batch(statements) {
      state.batchStatements = statements.map(statement => ({ sql: statement.sql, args: statement.args }));
      return { success: true };
    }
  };
}

test('Production checkout stays blocked when live payments are disabled', async () => {
  const db = fakeCheckoutDb({ planCode: 'Питание', programDays: 7 });
  const response = await workerModule.fetch(new Request('https://preview.example/api/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan: 'Питание', draft_id: 'draft-test' })
  }), {
    DB: db, ROBOKASSA_IS_TEST: '0', ROBOKASSA_LIVE_ENABLED: '0',
    ROBOKASSA_MERCHANT_LOGIN: 'merchant',
    ROBOKASSA_PASSWORD1: 'live-pass-1', ROBOKASSA_PASSWORD2: 'live-pass-2'
  });
  const data = await response.json();
  assert.equal(response.status, 503);
  assert.match(data.error, /реальных платежей пока отключён/);
  assert.equal(db.state.payments.length, 0);
});

test('valid Robokassa test ResultURL atomically activates the matching plan and access', async () => {
  const invoiceId = '1234567890';
  const clientRef = '0123456789abcdef0123456789abcdef';
  const draftId = 'draft-webhook-test';
  const plan = 'PRO';
  const amount = '1990.00';
  const password2 = 'test-pass-2';
  const fields = {
    OutSum: amount,
    InvId: invoiceId,
    Shp_client_ref: clientRef,
    Shp_plan: plan,
    EMail: 'Member@Example.com'
  };
  const shp = Object.keys(fields).filter(key => key.startsWith('Shp_')).sort().map(key => key + '=' + fields[key]);
  fields.SignatureValue = createHash('md5')
    .update([fields.OutSum, fields.InvId, password2, ...shp].join(':'))
    .digest('hex');
  const profile = { name: 'Test member', age: 30 };
  const planData = { planCode: plan, programDays: 14, week: [] };
  const db = fakeWebhookDb({ invoiceId, clientRef, plan, amount, draftId, profile, planData });
  const request = new Request('https://preview.example/webhooks/robokassa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields)
  });
  const response = await workerModule.fetch(request, {
    DB: db, ROBOKASSA_IS_TEST: '1',
    ROBOKASSA_TEST_PASSWORD2: password2
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'OK' + invoiceId);
  assert.equal(db.state.batchStatements.length, 4);
  assert.match(db.state.batchStatements[0].sql, /INSERT INTO subscriptions/);
  assert.equal(db.state.batchStatements[0].args[1], invoiceId);
  assert.equal(db.state.batchStatements[0].args[3], plan);
  assert.equal(db.state.batchStatements[0].args[4], 'active');
  assert.match(db.state.batchStatements[1].sql, /INSERT INTO profiles/);
  assert.equal(JSON.parse(db.state.batchStatements[1].args[1]).name, 'Test member');
  assert.match(db.state.batchStatements[2].sql, /INSERT INTO weekly_plans/);
  assert.equal(JSON.parse(db.state.batchStatements[2].args[2]).planCode, plan);
  assert.match(db.state.batchStatements[3].sql, /UPDATE payments SET status=\?/);
  assert.equal(db.state.batchStatements[3].args[0], 'succeeded');
  assert.equal(db.state.batchStatements[3].args[1], plan);
  assert.equal(db.state.batchStatements[3].args[2], amount);
  assert.equal(db.state.batchStatements[3].args[3], 'RUB');
});

function fakeProgressDb() {
  const state = { writes: [] };
  return {
    state,
    prepare(sql) {
      const query = {
        args: [],
        bind(...args) { this.args = args; return this; },
        async first() {
          if (sql.includes('FROM subscriptions WHERE access_token=?')) return { access_token: 'active-test-token', plan: 'PRO', status: 'active', expires_at: '2099-01-01T00:00:00.000Z' };
          return null;
        },
        async run() {
          if (sql.includes('INSERT INTO progress')) state.writes.push({ sql, args: this.args });
          return { success: true };
        },
        async all() {
          if (sql.includes('SELECT weight FROM progress')) return { results: [{ weight: 78 }] };
          return { results: [] };
        }
      };
      return query;
    }
  };
}

test('progress API accepts a valid ISO date and rejects impossible calendar dates', async () => {
  const validDb = fakeProgressDb();
  const validResponse = await workerModule.fetch(new Request('https://preview.example/api/progress', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer active-test-token' },
    body: JSON.stringify({ date: '2026-11-21', weight: 78, completed_meal: 1, completed_workout: 0 })
  }), { DB: validDb });
  assert.equal(validResponse.status, 200);
  assert.equal(validDb.state.writes.length, 1);
  assert.equal(validDb.state.writes[0].args[1], '2026-11-21');

  const invalidDb = fakeProgressDb();
  const invalidResponse = await workerModule.fetch(new Request('https://preview.example/api/progress', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer active-test-token' },
    body: JSON.stringify({ date: '2026-02-30', weight: 78, completed_meal: 1, completed_workout: 0 })
  }), { DB: invalidDb });
  assert.equal(invalidResponse.status, 400);
  assert.equal(invalidDb.state.writes.length, 0);
});
