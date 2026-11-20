import { readFile } from 'node:fs/promises';
import { writeFile } from 'node:fs/promises';

const file = process.argv[2] || 'public/app.js';
let source = await readFile(file, 'utf8');

const original = "const payment=params.get('payment_id');";
const patched = "const payment=params.get('payment_id') || params.get('InvId');";

if (source.includes(patched)) {
  console.log('Robokassa return parameter already supported.');
} else {
  const matches = source.split(original).length - 1;
  if (matches !== 1) {
    throw new Error(`Expected exactly one payment return declaration in ${file}; found ${matches}. No file changes made.`);
  }
  source = source.replace(original, patched);
  await writeFile(file, source, 'utf8');
  console.log('Added Robokassa InvId support to payment return handling.');
}

if (!source.includes("fetch('/api/payment-status?'+query")) {
  throw new Error('Expected payment-status request was not found; frontend contract changed.');
}
