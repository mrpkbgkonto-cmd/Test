import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../lib/app.js';
import { renderInvoicePdf } from '../lib/pdf.js';

const created = Math.floor(Date.now() / 1000);
const sessions = {
  cs_paid: { id: 'cs_paid', status: 'complete', payment_status: 'paid', created },
  cs_unpaid: { id: 'cs_unpaid', status: 'open', payment_status: 'unpaid', created },
  cs_expired: { id: 'cs_expired', status: 'expired', payment_status: 'unpaid', created },
};
let lastCreate;
const fakeStripe = {
  checkout: {
    sessions: {
      create: async (params) => {
        lastCreate = params;
        return { id: 'cs_new', url: 'https://checkout.stripe.test/pay' };
      },
      retrieve: async (id) => {
        if (!sessions[id]) throw new Error('No such checkout.session');
        return sessions[id];
      },
    },
  },
};

const invoice = {
  number: '1001',
  date: '2026-09-26',
  dueDate: '2026-10-26',
  seller: { name: 'Mitt Företag AB', orgNr: '556677-8899', bankgiro: '123-4567', fSkatt: true },
  buyer: { name: 'Kund AB', address: 'Storgatan 1\n123 45 Åby' },
  items: [{ desc: 'Konsulttimmar', qty: 10, unit: 'tim', price: 950, vat: 25 }],
};

let base;
let server;
before(async () => {
  const app = createApp({ stripe: fakeStripe, config: { tokenSecret: 's', priceSek: 99, passDays: 365, publicUrl: 'https://faktura.test' } });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

const post = (path, body) => fetch(base + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

test('gratis-PDF får vattenstämpel', async () => {
  const res = await post('/api/pdf', { invoice });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.equal(res.headers.get('x-watermark'), '1');
  assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
});

test('checkout skapar Stripe-session i SEK', async () => {
  const res = await post('/api/checkout', {});
  assert.deepEqual(await res.json(), { id: 'cs_new', url: 'https://checkout.stripe.test/pay' });
  assert.equal(lastCreate.line_items[0].price_data.currency, 'sek');
  assert.equal(lastCreate.line_items[0].price_data.unit_amount, 9900);
  assert.equal(lastCreate.success_url, 'https://faktura.test/?session_id={CHECKOUT_SESSION_ID}');
  assert.equal(lastCreate.cancel_url, 'https://faktura.test/?checkout=cancelled');
});

test('betalt köp ger licens som tar bort vattenstämpeln', async () => {
  const unlock = await fetch(`${base}/api/unlock?session_id=cs_paid`);
  assert.equal(unlock.status, 200);
  const { token, exp } = await unlock.json();
  assert.equal(exp, created * 1000 + 365 * 86_400_000);

  const res = await post('/api/pdf', { invoice, token });
  assert.equal(res.headers.get('x-watermark'), '0');

  const license = await post('/api/license', { token });
  assert.deepEqual(await license.json(), { exp });
});

test('obetalt, okänt eller ogiltigt köp låser inte upp', async () => {
  assert.equal((await fetch(`${base}/api/unlock?session_id=cs_unpaid`)).status, 402);
  assert.equal((await fetch(`${base}/api/unlock?session_id=cs_expired`)).status, 410);
  assert.equal((await fetch(`${base}/api/unlock?session_id=cs_missing`)).status, 404);
  assert.equal((await fetch(`${base}/api/unlock?session_id=../x`)).status, 400);
  assert.equal((await post('/api/license', { token: 'fejk.nyckel' })).status, 400);
  const res = await post('/api/pdf', { invoice, token: 'fejk.nyckel' });
  assert.equal(res.headers.get('x-watermark'), '1');
});

test('ogiltig faktura ger 400 med förklaring', async () => {
  const res = await post('/api/pdf', { invoice: { ...invoice, items: [{ qty: 1, price: 1, vat: 7 }] } });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /momssats/);
  assert.equal((await post('/api/pdf', { invoice: { ...invoice, buyer: {} } })).status, 400);
});

test('utan Stripe är köp avstängt men gratisversionen fungerar', async () => {
  const app = createApp();
  const s = app.listen(0);
  await new Promise((r) => s.once('listening', r));
  const url = `http://localhost:${s.address().port}`;
  try {
    assert.equal((await fetch(`${url}/api/checkout`, { method: 'POST' })).status, 503);
    assert.equal((await (await fetch(`${url}/api/config`)).json()).paymentsEnabled, false);
  } finally {
    s.close();
  }
});

const toBuffer = (doc) => new Promise((resolve) => {
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  doc.on('end', () => resolve(Buffer.concat(chunks)));
});

test('vattenstämpeln finns bara i gratisversionen och långa fakturor får flera sidor', async () => {
  const parsed = { ...invoice, notes: '', seller: { ...invoice.seller, address: '', vatNr: '', email: '', phone: '' }, buyer: { ...invoice.buyer, orgNr: '', vatNr: '', reference: '' } };
  const free = (await toBuffer(renderInvoicePdf(parsed, { watermark: true }))).toString('latin1');
  const paid = (await toBuffer(renderInvoicePdf(parsed, { watermark: false }))).toString('latin1');
  assert.match(free, /\/ca 0\.18/);
  assert.doesNotMatch(paid, /\/ca 0\.18/);

  const many = { ...parsed, items: Array.from({ length: 60 }, (_, i) => ({ desc: `Rad ${i}`, qty: 1, unit: 'st', price: 10, vat: 25 })) };
  const pdf = (await toBuffer(renderInvoicePdf(many, { watermark: false }))).toString('latin1');
  assert.ok((pdf.match(/\/Type \/Page\b/g) || []).length >= 2);
});
