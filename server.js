import Stripe from 'stripe';
import { createApp } from './lib/app.js';

const env = process.env;

if (env.STRIPE_SECRET_KEY && !env.TOKEN_SECRET) {
  console.error('TOKEN_SECRET måste sättas när Stripe är aktiverat, annars slutar köpta licenser fungera vid omstart.');
  process.exit(1);
}

const app = createApp({
  stripe: env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null,
  config: {
    appName: env.APP_NAME || undefined,
    priceSek: Number(env.PRICE_SEK) || undefined,
    passDays: Number(env.PASS_DAYS) || undefined,
    publicUrl: env.PUBLIC_URL?.replace(/\/$/, '') || undefined,
    tokenSecret: env.TOKEN_SECRET || undefined,
  },
});

const port = Number(env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Kör på http://localhost:${port}${env.STRIPE_SECRET_KEY ? '' : ' (Stripe ej konfigurerat – köp avstängt)'}`);
});
