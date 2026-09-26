import assert from 'node:assert/strict';
import test from 'node:test';
import { sign, verify } from '../lib/token.js';

const SECRET = 'test-secret';

test('godkänner en giltig nyckel', () => {
  const token = sign({ sid: 'cs_1', exp: Date.now() + 1000 }, SECRET);
  assert.equal(verify(token, SECRET).sid, 'cs_1');
});

test('avvisar manipulerad, utgången eller felsignerad nyckel', () => {
  const token = sign({ sid: 'cs_1', exp: Date.now() + 1000 }, SECRET);
  const [, sig] = token.split('.');
  const forged = `${Buffer.from(JSON.stringify({ sid: 'cs_1', exp: 9e15 })).toString('base64url')}.${sig}`;
  assert.equal(verify(forged, SECRET), null);
  assert.equal(verify(token, 'annan-hemlighet'), null);
  assert.equal(verify(sign({ exp: Date.now() - 1 }, SECRET), SECRET), null);
  assert.equal(verify('skräp', SECRET), null);
  assert.equal(verify(undefined, SECRET), null);
});
