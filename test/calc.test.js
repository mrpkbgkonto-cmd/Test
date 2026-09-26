import assert from 'node:assert/strict';
import test from 'node:test';
import { calcTotals, formatSek } from '../public/calc.js';

test('räknar moms per momssats', () => {
  const t = calcTotals([
    { qty: 2, price: 500, vat: 25 },
    { qty: 3, price: 33.33, vat: 12 },
    { qty: 1, price: 100, vat: 25 },
    { qty: 1, price: 50, vat: 0 },
  ]);
  assert.deepEqual(t.vatGroups, [
    { rate: 25, base: 1100, vat: 275 },
    { rate: 12, base: 99.99, vat: 12 },
    { rate: 0, base: 50, vat: 0 },
  ]);
  assert.equal(t.net, 1249.99);
  assert.equal(t.vat, 287);
  assert.equal(t.total, 1536.99);
});

test('formaterar kronor utan specialtecken som PDF-typsnitt saknar', () => {
  assert.equal(formatSek(1234.5), '1 234,50 kr');
  assert.equal(formatSek(-10), '-10,00 kr');
  assert.equal(formatSek(-0), '0,00 kr');
});
