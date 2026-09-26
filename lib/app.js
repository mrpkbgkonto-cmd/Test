import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { InvoiceError, parseInvoice } from './invoice.js';
import { renderInvoicePdf } from './pdf.js';
import { sign, verify } from './token.js';

const DAY = 86_400_000;

export function createApp({ stripe = null, config = {} } = {}) {
  const {
    appName = 'Fakturaverktyget',
    priceSek = 99,
    passDays = 365,
    publicUrl = '',
    tokenSecret = crypto.randomBytes(32).toString('hex'),
  } = config;

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));

  app.get('/api/config', (req, res) => {
    res.json({ appName, priceSek, passDays, paymentsEnabled: Boolean(stripe) });
  });

  app.post('/api/checkout', async (req, res) => {
    if (!stripe) return res.status(503).json({ error: 'Betalning är inte konfigurerad ännu.' });
    const origin = publicUrl || `${req.protocol}://${req.get('host')}`;
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      locale: 'sv',
      allow_promotion_codes: true,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'sek',
          unit_amount: Math.round(priceSek * 100),
          product_data: { name: `${appName} Pro – ${passDays} dagar`, description: 'Fakturor utan vattenstämpel.' },
        },
      }],
      success_url: `${origin}/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/`,
    });
    res.json({ url: session.url });
  });

  app.get('/api/unlock', async (req, res) => {
    if (!stripe) return res.status(503).json({ error: 'Betalning är inte konfigurerad ännu.' });
    const id = req.query.session_id;
    if (typeof id !== 'string' || !/^cs_\w+$/.test(id)) return res.status(400).json({ error: 'Ogiltigt köp-ID.' });
    let session;
    try {
      session = await stripe.checkout.sessions.retrieve(id);
    } catch {
      return res.status(404).json({ error: 'Köpet hittades inte.' });
    }
    if (session.payment_status !== 'paid') return res.status(402).json({ error: 'Betalningen är inte slutförd.' });
    // Räknas från köptillfället så att samma köp inte kan förlängas.
    const exp = session.created * 1000 + passDays * DAY;
    res.json({ token: sign({ sid: session.id, exp }, tokenSecret), exp });
  });

  app.post('/api/license', (req, res) => {
    const payload = verify(req.body?.token, tokenSecret);
    if (!payload) return res.status(400).json({ error: 'Ogiltig eller utgången licensnyckel.' });
    res.json({ exp: payload.exp });
  });

  app.post('/api/pdf', (req, res) => {
    const invoice = parseInvoice(req.body?.invoice);
    const watermark = !verify(req.body?.token, tokenSecret);
    const file = invoice.number.replace(/[^\w-]/g, '_');
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="faktura-${file}.pdf"`,
      'X-Watermark': watermark ? '1' : '0',
    });
    renderInvoicePdf(invoice, { watermark, appName, brandUrl: publicUrl.replace(/^https?:\/\//, '') }).pipe(res);
  });

  app.use((err, req, res, next) => {
    if (err instanceof InvoiceError) return res.status(400).json({ error: err.message });
    if (err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: 'Ogiltig förfrågan.' });
    console.error(err);
    res.status(500).json({ error: 'Något gick fel. Försök igen.' });
  });

  return app;
}
