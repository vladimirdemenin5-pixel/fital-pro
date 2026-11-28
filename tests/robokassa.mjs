import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  setRobokassaReceiptParameter,
  buildRobokassaPaymentSignature,
  setRobokassaRedirectParameters,
  robokassaResultSignature,
  verifyRobokassaResultSignature
} from '../_worker.js';

const md5 = value => createHash('md5').update(value, 'utf8').digest('hex').toUpperCase();
const commonInput = {
  merchant: 'fitalpro',
  outSum: '990.00',
  invId: 42,
  password1: 'fixture-test-password-1',
  clientRef: 'test-order-ref'
};
const receiptJson = JSON.stringify({
  items: [{
    name: 'Fital Pro — Питание, 7 дней',
    quantity: 1,
    sum: 990,
    payment_method: 'full_prepayment',
    payment_object: 'service',
    tax: 'none'
  }]
});
const receiptParams = new URLSearchParams();
const receiptForSignature = setRobokassaReceiptParameter(receiptParams, receiptJson);
assert.equal(receiptParams.get('Receipt'), encodeURIComponent(receiptJson),
  'Robokassa Receipt parameter must contain URL-encoded JSON');
assert.equal(new URLSearchParams(receiptParams.toString()).get('Receipt'), encodeURIComponent(receiptJson),
  'transport decoding must preserve the URL-encoded Receipt value');
assert.equal(decodeURIComponent(new URLSearchParams(receiptParams.toString()).get('Receipt')), receiptJson,
  'the transported Receipt value must decode to the exact fiscal JSON');

// TEST CHECKOUT: only Receipt is a modifier; neither secondary redirect URL nor method is sent or signed.
const testParams = new URLSearchParams();
const testRedirects = setRobokassaRedirectParameters(testParams, {
  forceTestMode: true,
  requestUrl: 'https://fital-pro.example/checkout',
  clientRef: commonInput.clientRef
});
assert.deepEqual(testRedirects, { successUrl2: undefined, failUrl2: undefined });
assert.deepEqual([...testParams.keys()], [],
  'test checkout must not send SuccessUrl2/FailUrl2 or their methods');
const testInput = { ...commonInput, receipt: receiptForSignature };
const expectedTestBase = [
  commonInput.merchant,
  commonInput.outSum,
  String(commonInput.invId),
  receiptForSignature,
  commonInput.password1,
  'Shp_ref=' + commonInput.clientRef
].join(':');
const expectedTestSignature = md5(expectedTestBase);
assert.equal(buildRobokassaPaymentSignature(testInput), expectedTestSignature,
  'test SignatureValue must be MD5 of MerchantLogin:OutSum:InvId:Receipt:test Password #1:Shp_ref');

// PRODUCTION REGRESSION: preserve both secondary redirects, GET methods and their exact signature order.
const productionParams = new URLSearchParams();
const productionRedirects = setRobokassaRedirectParameters(productionParams, {
  forceTestMode: false,
  requestUrl: 'https://fital-pro.example/checkout',
  clientRef: commonInput.clientRef
});
const expectedSuccessUrl = 'https://fital-pro.example/?payment=success&ref=test-order-ref';
const expectedFailUrl = 'https://fital-pro.example/?payment=fail';
assert.deepEqual(productionRedirects, {
  successUrl2: encodeURIComponent(expectedSuccessUrl),
  failUrl2: encodeURIComponent(expectedFailUrl)
});
assert.deepEqual([...productionParams.entries()], [
  ['SuccessUrl2', expectedSuccessUrl],
  ['SuccessUrl2Method', 'GET'],
  ['FailUrl2', expectedFailUrl],
  ['FailUrl2Method', 'GET']
], 'Production must retain the exact existing secondary redirect parameters and methods');
const productionInput = {
  ...commonInput,
  receipt: receiptForSignature,
  successUrl2: productionRedirects.successUrl2,
  failUrl2: productionRedirects.failUrl2
};
const expectedProductionBase = [
  commonInput.merchant,
  commonInput.outSum,
  String(commonInput.invId),
  receiptForSignature,
  productionRedirects.successUrl2,
  'GET',
  productionRedirects.failUrl2,
  'GET',
  commonInput.password1,
  'Shp_ref=' + commonInput.clientRef
].join(':');
assert.equal(buildRobokassaPaymentSignature(productionInput), md5(expectedProductionBase),
  'Production SignatureValue must retain the existing URL modifiers in documented order');

// ResultURL regression coverage.
const fields = {
  OutSum: '990.00',
  InvId: '42',
  Shp_ref: 'test-order-ref',
  Shp_z: 'last',
  Shp_a: 'first'
};
const expectedResultBase = '990.00:42:fixture-test-password-2:Shp_a=first:Shp_ref=test-order-ref:Shp_z=last';
const expectedResultSignature = md5(expectedResultBase);
assert.equal(robokassaResultSignature(fields.OutSum, fields.InvId, 'fixture-test-password-2', fields), expectedResultSignature,
  'ResultURL signature must sort all Shp parameters by name');
assert.equal(verifyRobokassaResultSignature(fields.OutSum, fields.InvId, 'fixture-test-password-2', fields, expectedResultSignature), true,
  'valid ResultURL signature must be accepted');
assert.equal(verifyRobokassaResultSignature(fields.OutSum, fields.InvId, 'wrong-password', fields, expectedResultSignature), false,
  'wrong Password #2 must be rejected');
assert.equal(verifyRobokassaResultSignature('990.01', fields.InvId, 'fixture-test-password-2', fields, expectedResultSignature), false,
  'tampered payment amount must be rejected');
assert.equal(verifyRobokassaResultSignature(fields.OutSum, fields.InvId, 'fixture-test-password-2', { ...fields, Shp_ref: 'other-order' }, expectedResultSignature), false,
  'tampered order reference must be rejected');

console.log('PASS: Robokassa test/Production payment signatures and ResultURL regression tests');
