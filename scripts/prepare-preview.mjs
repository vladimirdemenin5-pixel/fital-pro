import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const PREVIEW_DB_NAME = 'fital-pro-preview-db';
const GENERATED_CONFIG = 'wrangler.preview.generated.jsonc';

function parseJsonOutput(output, label) {
  const text = String(output || '').trim();
  for (let index = 0; index < text.length; index++) {
    if (text[index] !== '[' && text[index] !== '{') continue;
    try { return JSON.parse(text.slice(index)); } catch {}
  }
  throw new Error('Wrangler did not return valid JSON for ' + label + '.');
}
function collectDatabaseEntries(value, entries = []) {
  if (Array.isArray(value)) { for (const item of value) collectDatabaseEntries(item, entries); return entries; }
  if (!value || typeof value !== 'object') return entries;
  const name = value.name || value.database_name;
  const id = value.uuid || value.database_id || value.id;
  if (typeof name === 'string' && typeof id === 'string') entries.push({ name, id });
  for (const child of Object.values(value)) if (child && typeof child === 'object') collectDatabaseEntries(child, entries);
  return entries;
}
export function findDatabaseId(payload, name) {
  return collectDatabaseEntries(payload).find(item => item.name === name)?.id || '';
}
export function buildPreviewConfig(productionConfig, previewDatabaseId) {
  const productionBinding = (productionConfig.d1_databases || []).find(item => item.binding === 'DB');
  if (!productionBinding?.database_id) throw new Error('The existing production D1 binding DB was not found in wrangler.jsonc.');
  if (!previewDatabaseId || previewDatabaseId === productionBinding.database_id) {
    throw new Error('Preview D1 must use a database ID different from Production.');
  }
  const previewBinding = {
    binding: 'DB',
    database_name: PREVIEW_DB_NAME,
    database_id: previewDatabaseId,
    migrations_dir: productionBinding.migrations_dir || 'migrations'
  };
  return {
    ...productionConfig,
    d1_databases: [previewBinding],
    previews: { ...(productionConfig.previews || {}), d1_databases: [previewBinding] }
  };
}
function runWrangler(args) {
  try {
    return execFileSync('npx', ['wrangler', ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: process.env
    });
  } catch (error) {
    const detail = String(error.stderr || error.stdout || error.message || '').trim().slice(-1800);
    if (/Authentication error \\[code: 10000\\]/i.test(detail)) {
      throw new Error('Cloudflare rejected D1 access: the API token stored in GitHub secret CLOUDFLARE_API_TOKEN needs Account → D1 → Edit permission. Keep its existing Workers Scripts permissions. Preview deployment stopped before any D1 database was created or changed.');
    }
    throw new Error('Wrangler command failed (' + args.join(' ') + '): ' + detail);
  }
}
async function main() {
  if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
    throw new Error('Cloudflare credentials are missing; Preview D1 was not created or changed.');
  }
  const productionConfig = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
  const productionBinding = (productionConfig.d1_databases || []).find(item => item.binding === 'DB');
  if (!productionBinding?.database_id) throw new Error('Production D1 binding DB is missing.');
  let payload = parseJsonOutput(runWrangler(['d1', 'list', '--json']), 'D1 list');
  let previewId = findDatabaseId(payload, PREVIEW_DB_NAME);
  if (!previewId) {
    console.log('Creating the dedicated Preview database; Production D1 will not be modified.');
    try { runWrangler(['d1', 'create', PREVIEW_DB_NAME, '--location', 'weur']); }
    catch (error) {
      payload = parseJsonOutput(runWrangler(['d1', 'list', '--json']), 'D1 list after create');
      previewId = findDatabaseId(payload, PREVIEW_DB_NAME);
      if (!previewId) throw error;
    }
    if (!previewId) {
      payload = parseJsonOutput(runWrangler(['d1', 'list', '--json']), 'D1 list after create');
      previewId = findDatabaseId(payload, PREVIEW_DB_NAME);
    }
  }
  if (!previewId || previewId === productionBinding.database_id) {
    throw new Error('Could not establish a separate Preview D1 database. Preview deployment stopped safely.');
  }
  const previewConfig = buildPreviewConfig(productionConfig, previewId);
  await writeFile(GENERATED_CONFIG, JSON.stringify(previewConfig, null, 2) + '\n', 'utf8');
  console.log('Applying repository migrations only to the isolated Preview D1 database.');
  runWrangler(['d1', 'migrations', 'apply', PREVIEW_DB_NAME, '--remote', '--config', GENERATED_CONFIG]);
  console.log('PASS: Preview uses a separate D1 database; committed Production D1 configuration remains unchanged.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message || error); process.exitCode = 1; });
}
