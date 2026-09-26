# Fakturaverktyget

Enkel webbapp där småföretagare skapar fakturor som PDF.

- **Gratis:** full funktion, men PDF:en får vattenstämpel + "Skapad gratis med …" (gratis marknadsföring för dig).
- **Pro (99 kr / 365 dagar):** köps via Stripe, tar bort vattenstämpeln.

PDF:en utan vattenstämpel skapas bara på servern mot en giltig, signerad licensnyckel – den går inte att fuska fram i webbläsaren.

## Kör lokalt

```bash
npm install
cp .env.example .env
npm run dev        # http://localhost:3000
npm test
```

Utan `STRIPE_SECRET_KEY` fungerar gratisversionen; köpknappen är avstängd.

## Aktivera betalning

1. Skapa konto på [stripe.com](https://stripe.com) och kopiera test-nyckeln (`sk_test_…`) till `STRIPE_SECRET_KEY` i `.env`.
2. Sätt `TOKEN_SECRET` till en lång slumpsträng (kommando finns i `.env.example`). **Byt den aldrig efter lansering** – då slutar alla sålda licenser fungera.
3. Testa ett köp med kortet `4242 4242 4242 4242`, valfritt framtida datum och CVC.
4. Betalmetoder (kort m.m.) väljs i Stripe Dashboard.

## Publicera

Valfri Node-host (t.ex. Render, Railway, Fly.io):

- Build: `npm install` · Start: `npm start`
- Miljövariabler: `STRIPE_SECRET_KEY` (live-nyckel `sk_live_…`), `TOKEN_SECRET`, `PUBLIC_URL` (din adress), ev. `APP_NAME`, `PRICE_SEK`, `PASS_DAYS`.

## Få betalande kunder

- Vattenstämpeln visar din adress (`PUBLIC_URL`) – varje gratisfaktura är reklam.
- Sidan är SEO-anpassad för "skapa faktura gratis".
- Dela i grupper för egenföretagare/småföretagare; testa Google Ads på "fakturamall".
- Rabattkoder skapas i Stripe Dashboard (kassan tillåter dem).

## Bra att veta

- Licensen sparas i kundens webbläsare. Vid byte av dator: "Kopiera licensnyckel" → "Har du en licensnyckel?".
- Stänger kunden fliken innan omdirigeringen efter betalningen får den ingen nyckel automatiskt – kontrollera köpet i Stripe och hjälp manuellt.
- Stripe tar en avgift per betalning. Redovisa moms och intäkter för försäljningen i ditt bolag.

## Struktur

```
server.js          start + miljövariabler
lib/app.js         API: /api/pdf, /api/checkout, /api/unlock, /api/license
lib/pdf.js         PDF-layout (pdfkit)
lib/invoice.js     validering
lib/token.js       signerade licensnycklar (HMAC)
public/            webbappen (calc.js delas med servern)
test/              node --test
```
