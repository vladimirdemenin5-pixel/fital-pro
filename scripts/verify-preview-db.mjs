import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const EXPECTED_PREVIEW_D1_ID = '54bd4cbb-f267-4c1e-af16-cdc9b24953c1';
const EXPECTED_PRODUCTION_D1_ID = 'd2bdb339-bc7b-420e-be7f-0496ce46a09b';

export function verifyPreviewMigrationConfig(workerConfig, migrationConfig) {
  const previewDbs = workerConfig?.previews?.d1_databases;
  const productionDbs = workerConfig?.d1_databases;
  const migrationDbs = migrationConfig?.d1_databases;
  if (!Array.isArray(previewDbs) || previewDbs.length !== 1) throw new Error('Expected exactly one Preview D1 binding.');
  if (!Array.isArray(productionDbs) || !productionDbs.some(db => db.database_name === 'fital-pro-db' && db.database_id === EXPECTED_PRODUCTION_D1_ID)) throw new Error('Existing Production D1 name or ID does not match the verified configuration.');
  if (!Array.isArray(migrationDbs) || migrationDbs.length !== 1) throw new Error('Expected exactly one D1 target in the Preview migration config.');
  const preview = previewDbs[0];
  const target = migrationDbs[0];
  if (preview.database_name !== 'fital-pro-preview-db' || target.database_name !== 'fital-pro-preview-db') throw new Error('Migration target must be fital-pro-preview-db.');
  if (preview.database_id !== EXPECTED_PREVIEW_D1_ID || target.database_id !== EXPECTED_PREVIEW_D1_ID) throw new Error('Preview D1 ID does not match the verified existing Preview database.');
  if (target.database_id !== preview.database_id) throw new Error('Preview Worker and migration config database IDs do not match.');
  if (target.binding !== 'PREVIEW_DB' || target.migrations_dir !== 'migrations') throw new Error('Preview migration binding or migrations directory is incorrect.');
  if (productionDbs.some(db => db.database_name === target.database_name || db.database_id === target.database_id)) throw new Error('Preview migration target points to Production D1.');
  return { database_name: target.database_name, database_id: target.database_id };
}

export function verifyMigrationSequence(filenames) {
  const files = filenames.filter(name => name.endsWith('.sql')).sort();
  if (!files.length) throw new Error('No SQL migrations were found.');
  const versions = files.map(name => {
    const match = name.match(/^(\d{4})_.+\.sql$/);
    if (!match) throw new Error('Invalid migration filename: ' + name);
    return Number(match[1]);
  });
  for (let i = 0; i < versions.length; i += 1) {
    if (versions[i] !== i + 1) throw new Error('Migration sequence has a gap or duplicate at ' + files[i] + '.');
  }
  return files;
}

async function runPreflight() {
  const workerConfig = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  const migrationConfig = JSON.parse(await readFile(new URL('../wrangler.preview-migrations.jsonc', import.meta.url), 'utf8'));
  const migrationDir = fileURLToPath(new URL('../migrations/', import.meta.url));
  const target = verifyPreviewMigrationConfig(workerConfig, migrationConfig);
  const files = verifyMigrationSequence(await readdir(migrationDir));
  console.log('Preview D1 target verified: ' + target.database_name + ' (' + target.database_id + ').');
  console.log('Production D1 is a different database and is not a migration target.');
  console.log('Migration sequence verified: ' + files[0] + ' through ' + files[files.length - 1] + ' (' + files.length + ' files).');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runPreflight().catch(error => {
    console.error('Preview migration preflight failed: ' + error.message);
    process.exitCode = 1;
  });
}
