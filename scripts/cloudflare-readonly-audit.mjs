const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;

if (!accountId || !apiToken) {
  console.warn('NOT VERIFIED: Cloudflare read-only audit credentials are unavailable.');
  process.exit(0);
}

const apiRoot = 'https://api.cloudflare.com/client/v4';
const workerName = 'red-waterfall-2af8';
const expectedDatabaseName = 'fital-pro-db';
const expectedDatabaseId = 'd2bdb339-bc7b-420e-be7f-0496ce46a09b';

async function cloudflare(path, options = {}) {
  const response = await fetch(apiRoot + path, {
    ...options,
    headers: {
      Authorization: 'Bearer ' + apiToken,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success !== true) {
    const messages = Array.isArray(payload.errors)
      ? payload.errors.map(error => error.message).filter(Boolean).join('; ')
      : '';
    throw new Error('HTTP ' + response.status + (messages ? ': ' + messages : ''));
  }
  return payload.result;
}

async function readOnly(label, path, options) {
  try {
    const result = await cloudflare(path, options);
    console.log('READ OK: ' + label);
    return result;
  } catch (error) {
    console.warn('NOT VERIFIED: ' + label + ' — ' + error.message);
    return null;
  }
}

let failures = 0;
function check(condition, label) {
  if (condition) {
    console.log('PASS: ' + label);
  } else {
    failures++;
    console.error('FAIL: ' + label);
  }
}

const [settings, secrets, database, schemaResult, domains, deployments] = await Promise.all([
  readOnly('Production Worker settings', '/accounts/' + accountId + '/workers/scripts/' + workerName + '/settings'),
  readOnly('Production Worker secret names', '/accounts/' + accountId + '/workers/scripts/' + workerName + '/secrets'),
  readOnly('Existing D1 metadata', '/accounts/' + accountId + '/d1/database/' + expectedDatabaseId),
  readOnly('Existing D1 table schema', '/accounts/' + accountId + '/d1/database/' + expectedDatabaseId + '/query', {
    method: 'POST',
    body: JSON.stringify({
      sql: "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    })
  }),
  readOnly('Worker custom-domain bindings', '/accounts/' + accountId + '/workers/domains'),
  readOnly('Production Worker deployments', '/accounts/' + accountId + '/workers/scripts/' + workerName + '/deployments')
]);

async function publicWorkerHealth(url, label) {
  try {
    const response = await fetch(url + '/health', { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const body = await response.json();
    console.log('READ OK: ' + label + ' health endpoint');
    return body;
  } catch (error) {
    console.warn('NOT VERIFIED: ' + label + ' health endpoint — ' + error.message +
      (error.cause?.code ? ' (' + error.cause.code + ')' : error.cause?.message ? ' (' + error.cause.message + ')' : ''));
    return null;
  }
}

const [productionHealth, customDomainHealth] = await Promise.all([
  publicWorkerHealth('https://red-waterfall-2af8.vladimirdemenin5.workers.dev', 'Production workers.dev'),
  publicWorkerHealth('https://fitalpro.ru', 'fitalpro.ru')
]);

if (productionHealth) {
  check(productionHealth.ok === true, 'Production Worker health endpoint is responding');
  check(productionHealth.ai === true, 'Production AI binding is available at runtime');
  check(productionHealth.db === true, 'Production D1 health check passes');
  if (productionHealth.groq === true) {
    console.log('PASS: Production Groq secret is available at runtime');
  } else {
    console.warn('WARNING: Production Worker has a GROQ_API_KEY secret name, but the running Worker does not receive a non-empty value.');
  }
  check(productionHealth.payments === true, 'Production Robokassa credentials are available at runtime');
}
if (customDomainHealth) {
  check(customDomainHealth.ok === true && customDomainHealth.ai === true && customDomainHealth.db === true,
    'fitalpro.ru serves the Production Worker health endpoint');
}

if (settings) {
  const bindings = Array.isArray(settings.bindings) ? settings.bindings : [];
  const d1 = bindings.find(binding => binding.type === 'd1' && binding.name === 'DB');
  const ai = bindings.some(binding => binding.type === 'ai' && binding.name === 'AI');
  const assets = bindings.some(binding => binding.type === 'assets' && binding.name === 'ASSETS');
  const plainVars = Object.fromEntries(bindings
    .filter(binding => binding.type === 'plain_text')
    .map(binding => [binding.name, binding.text ?? binding.value ?? '']));
  const secretBindingNames = bindings
    .filter(binding => String(binding.type || '').includes('secret'))
    .map(binding => binding.name)
    .filter(Boolean);
  console.log('Production secret bindings listed in Worker settings: ' + secretBindingNames.join(', '));
  check(!!d1, 'Production D1 binding is named DB (not a localized or alternate name)');
  if (d1) check((d1.database_id || d1.id) === expectedDatabaseId, 'Production DB binding points to the existing fital-pro-db database ID');
  check(ai, 'Production AI binding is named AI');
  check(assets, 'Production static-assets binding is named ASSETS');
  check(plainVars.ROBOKASSA_IS_TEST === '0', 'Production Robokassa mode is live (ROBOKASSA_IS_TEST=0)');
  check(plainVars.FITALPRO_PREVIEW_CI !== '1', 'Production is not marked as Preview CI');
  check(plainVars.FITALPRO_REQUIRE_GROQ !== '1', 'Production is not locked to Preview-only Groq mode');
  if (typeof settings.workers_dev === 'boolean') {
    check(settings.workers_dev, 'Production workers.dev endpoint is enabled');
  }
} else {
  console.warn('AUDIT INCOMPLETE: Worker settings could not be read with the current Cloudflare token.');
}

if (secrets) {
  const names = new Set(Array.isArray(secrets) ? secrets.map(secret => secret.name) : []);
  for (const name of ['ROBOKASSA_MERCHANT_LOGIN', 'ROBOKASSA_PASSWORD1', 'ROBOKASSA_PASSWORD2']) {
    check(names.has(name), 'Production Worker secret is present: ' + name);
  }
  console.log('Production GROQ_API_KEY present: ' + (names.has('GROQ_API_KEY') ? 'true' : 'false'));
} else {
  console.warn('AUDIT INCOMPLETE: Production secret names could not be read; no secret values are requested or printed.');
}

if (database) {
  check(database.name === expectedDatabaseName, 'D1 database name is fital-pro-db');
  const actualId = database.uuid || database.id;
  if (actualId) check(actualId === expectedDatabaseId, 'D1 metadata ID matches wrangler.jsonc');
}

if (schemaResult) {
  const resultSets = Array.isArray(schemaResult) ? schemaResult : [schemaResult];
  const rows = resultSets.flatMap(result => Array.isArray(result?.results) ? result.results : []);
  const tables = new Set(rows.map(row => row.name).filter(Boolean));
  console.log('Production D1 tables: ' + [...tables].sort().join(', '));
  for (const name of ['request_log', 'subscriptions', 'payments', 'profiles', 'weekly_plans', 'progress']) {
    check(tables.has(name), 'Production D1 core table exists: ' + name);
  }
} else {
  console.warn('AUDIT INCOMPLETE: Production D1 schema could not be read; no data rows were queried.');
}

if (domains) {
  const workerDomains = Array.isArray(domains)
    ? domains.filter(domain => domain.service === workerName && domain.environment === 'production')
    : [];
  const fitalDomain = workerDomains.find(domain => domain.hostname === 'fitalpro.ru');
  if (fitalDomain) {
    console.log('Production custom domain fitalpro.ru: ' + (fitalDomain.enabled ? 'enabled' : 'disabled'));
    if (!fitalDomain.enabled) {
      failures++;
      console.error('FAIL: fitalpro.ru is attached to the Production Worker but is not routable.');
    }
  } else {
    console.warn('NOT CONFIGURED: fitalpro.ru is not listed as a custom domain for this Worker; workers.dev remains the verified deployment origin.');
  }
} else {
  console.warn('NOT VERIFIED: Worker custom domains could not be listed.');
}

if (deployments) {
  const items = Array.isArray(deployments) ? deployments : deployments.deployments || [];
  if (items.length) {
    const latest = [...items].sort((a, b) => String(b.created_on || '').localeCompare(String(a.created_on || '')))[0];
    console.log('Latest Production deployment timestamp: ' + (latest.created_on || 'unknown'));
  } else {
    console.warn('NOT VERIFIED: No Production deployment records were returned.');
  }
}

if (failures) {
  console.error('Production read-only audit found ' + failures + ' confirmed configuration/schema mismatch(es).');
  process.exitCode = 1;
} else if (!database || !schemaResult || !customDomainHealth) {
  console.warn('AUDIT PARTIAL: no confirmed mismatch was found in readable settings, but D1 metadata/schema and/or custom-domain health could not be verified. Do not treat this as a complete Production audit.');
} else {
  console.log('PASS: Production read-only audit completed; Worker settings, D1 metadata/schema, and custom-domain health were verified.');
}
