import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  buildRobokassaPaymentSignature,
  robokassaResultSignature,
  verifyRobokassaResultSignature
} from '../_worker.js';

const paymentInput = {
  merchant: 'fitalpro-test',
  outSum: '990.00',
  invId: 42,
  successUrl2: 'https%3A%2F%2Fexample.test%2F%3Fpayment%3Dsuccess',
  failUrl2: 'https%3A%2F%2Fexample.test%2F%3Fpayment%3Dfail',
  password1: 'test-password-1',
  clientRef: 'test-order-ref'
};
const paymentBase = [
  paymentInput.merchant,
  paymentInput.outSum,
  paymentInput.invId,
  '',
  '',
  '',
  paymentInput.successUrl2,
  'GET',
  paymentInput.failUrl2,
  'GET',
  paymentInput.password1,
  'Shp_ref=' + paymentInput.clientRef
].join(':');
const expectedPaymentSignature = createHash('md5').update(paymentBase, 'utf8').digest('hex').toUpperCase();
assert.equal(buildRobokassaPaymentSignature(paymentInput), expectedPaymentSignature,
  'payment signature must include the three empty Robokassa parameter slots in the documented order');
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
const receiptInput = { ...paymentInput, receipt: encodeURIComponent(receiptJson) };
const receiptBase = [
  receiptInput.merchant,
  receiptInput.outSum,
  receiptInput.invId,
  receiptInput.receipt,
  '',
  '',
  receiptInput.successUrl2,
  'GET',
  receiptInput.failUrl2,
  'GET',
  receiptInput.password1,
  'Shp_ref=' + receiptInput.clientRef
].join(':');
const expectedReceiptSignature = createHash('md5').update(receiptBase, 'utf8').digest('hex').toUpperCase();
assert.equal(buildRobokassaPaymentSignature(receiptInput), expectedReceiptSignature,
  'payment signature must include URL-encoded Receipt and preserve the documented modifier order');

const fields = {
  OutSum: '990.00',
  InvId: '42',
  Shp_ref: 'test-order-ref',
  Shp_z: 'last',
  Shp_a: 'first'
};
const expectedResultBase = '990.00:42:test-password-2:Shp_a=first:Shp_ref=test-order-ref:Shp_z=last';
const expectedResultSignature = createHash('md5').update(expectedResultBase, 'utf8').digest('hex').toUpperCase();
assert.equal(robokassaResultSignature(fields.OutSum, fields.InvId, 'test-password-2', fields), expectedResultSignature,
  'ResultURL signature must sort all Shp parameters by name');
assert.equal(verifyRobokassaResultSignature(fields.OutSum, fields.InvId, 'test-password-2', fields, expectedResultSignature), true,
  'valid ResultURL signature must be accepted');
assert.equal(verifyRobokassaResultSignature(fields.OutSum, fields.InvId, 'wrong-password', fields, expectedResultSignature), false,
  'wrong Password #2 must be rejected');
assert.equal(verifyRobokassaResultSignature('990.01', fields.InvId, 'test-password-2', fields, expectedResultSignature), false,
  'tampered payment amount must be rejected');
assert.equal(verifyRobokassaResultSignature(fields.OutSum, fields.InvId, 'test-password-2', { ...fields, Shp_ref: 'other-order' }, expectedResultSignature), false,
  'tampered order reference must be rejected');

console.log('PASS: Robokassa payment and ResultURL signature regression tests');
