import { readFile } from 'node:fs/promises';
import { writeFile } from 'node:fs/promises';

const file = process.argv[2] || 'public/app.js';
let source = await readFile(file, 'utf8');

function replaceExactlyOnce(from, to, description) {
  if (source.includes(to)) return;
  const matches = source.split(from).length - 1;
  if (matches !== 1) {
    throw new Error(`Expected exactly one ${description} in ${file}; found ${matches}. No file changes made.`);
  }
  source = source.replace(from, to);
}

replaceExactlyOnce(
  "const payment=params.get('payment_id');\n  const paymentRef=params.get('payment_ref');",
  "const payment=params.get('InvId') || params.get('payment_id');\n  const paymentRef=params.get('Shp_client_ref') || params.get('payment_ref');",
  'payment return parameter block'
);

replaceExactlyOnce(
  "const query=payment ? 'id='+encodeURIComponent(payment) : 'ref='+encodeURIComponent(paymentRef);",
  "const query=paymentRef ? 'ref='+encodeURIComponent(paymentRef) : 'id='+encodeURIComponent(payment);",
  'payment-status query'
);

replaceExactlyOnce(
  "if(d.status==='active' || d.status==='succeeded'){",
  "if((d.status==='active' || d.status==='succeeded') && d.access_token){",
  'confirmed-payment access-token guard'
);

if (!source.includes("params.get('Shp_client_ref')") ||
    !source.includes("'ref='+encodeURIComponent(paymentRef)") ||
    !source.includes("&& d.access_token") ||
    !source.includes("fetch('/api/payment-status?'+query")) {
  throw new Error('Robokassa return flow validation failed; no file changes made.');
}

await writeFile(file, source, 'utf8');
console.log('Robokassa return now uses Shp_client_ref to retrieve the access token safely.');
