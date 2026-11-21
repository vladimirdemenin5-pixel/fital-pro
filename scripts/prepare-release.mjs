import { access, readFile } from 'node:fs/promises';

const required = ['_worker.js', 'public/index.html', 'public/app.js', 'public/styles.css', 'wrangler.jsonc'];
for (const file of required) await access(file);
const worker = await readFile('_worker.js', 'utf8');
const app = await readFile('public/app.js', 'utf8');
if (!worker.includes('programDays') || !app.includes('/api/plan-preview')) {
  throw new Error('The committed Fital Pro source does not contain the current AI plan flow.');
}
process.stdout.write('Current committed Fital Pro source validated. No archive extraction or file replacement performed.\n');
