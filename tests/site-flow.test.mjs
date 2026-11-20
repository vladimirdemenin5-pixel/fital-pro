import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const readConfigLiteral = value => value;
const [worker, app, html, css, workflow, config, packageJson] = await Promise.all([
  read('_worker.js'), read('public/app.js'), read('public/index.html'),
  read('public/styles.css'), read('.github/workflows/main.yml'),
  read('wrangler.jsonc'), read('package.json'),
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

test('payment return and member cabinet initialization remain reachable', () => {
  assert.match(app, /paymentReturn\(\);loadCabinet\(\);/);
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

test('Preview is isolated and production payments default to disabled', () => {
  const config = JSON.parse(readConfigLiteral(config));
  assert.equal(config.vars.ROBOKASSA_LIVE_ENABLED, '0');
  assert.equal(config.previews.vars.ROBOKASSA_IS_TEST, '1');
  assert.equal(config.previews.vars.ROBOKASSA_LIVE_ENABLED, '0');
  assert.equal(config.d1_databases[0].database_name, 'fital-pro-db');
  assert.equal(config.previews.d1_databases[0].database_name, 'fital-pro-preview-db');
  assert.equal(JSON.parse(packageJson).scripts.preview, 'wrangler preview');
});
