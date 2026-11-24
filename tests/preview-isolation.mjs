import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildPreviewConfig, findDatabaseId } from '../scripts/prepare-preview.mjs';

const production = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const productionId = production.d1_databases.find(item => item.binding === 'DB').database_id;
const previewId = '11111111-2222-4333-8444-555555555555';
const payload = { success: true, result: [
  { name: 'fital-pro-db', uuid: productionId },
  { name: 'fital-pro-preview-db', uuid: previewId }
] };
assert.equal(findDatabaseId(payload, 'fital-pro-preview-db'), previewId);
assert.equal(findDatabaseId(payload, 'missing-db'), '');
const generated = buildPreviewConfig(production, previewId);
assert.equal(generated.d1_databases[0].database_name, 'fital-pro-preview-db');
assert.equal(generated.d1_databases[0].database_id, previewId);
assert.equal(generated.previews.d1_databases[0].database_id, previewId);
assert.notEqual(generated.previews.d1_databases[0].database_id, productionId);
assert.equal(production.d1_databases[0].database_id, productionId);
assert.equal(production.previews.d1_databases, undefined);
assert.throws(() => buildPreviewConfig(production, productionId), /different from Production/);
console.log('PASS: Preview D1 is isolated from the committed Production database configuration.');
