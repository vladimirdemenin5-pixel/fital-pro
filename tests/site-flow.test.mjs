import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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
  assert.match(app, /trainingIncluded=plan\.trainingIncluded!==false/);
  assert.match(html, /id="trainingFields"/);
  assert.match(html, /id="planDaysLabel"/);
  assert.match(worker, /const includeTraining=planCode!=='Питание'/);
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

test('one AI draft cannot create multiple active orders', () => {
  assert.ok(oneDraftMigration.includes('CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_one_checkout_per_draft'));
  assert.ok(oneDraftMigration.includes("WHERE draft_id IS NOT NULL AND status IN ('pending','succeeded')"));
  assert.match(worker, /existingOrder=.*payments WHERE draft_id/);
});

test('live payments require an explicit enable flag', () => {
  assert.match(worker, /ROBOKASSA_LIVE_ENABLED!=='1'/);
  assert.match(worker, /ROBOKASSA_LIVE_ENABLED==='1'/);
});

test('NodeList handlers use querySelectorAll, not querySelector', () => {
  assert.match(app, /\$\$\('#nav a'\)\.forEach/);
  assert.match(app, /\$\$\('\[data-plan\]'\)\.forEach/);
  assert.match(app, /\$\$\('\[data-question\]'\)\.forEach/);
  assert.doesNotMatch(app, /(^|[^$])\$\([^\)\n]+\)\.forEach/m);
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
