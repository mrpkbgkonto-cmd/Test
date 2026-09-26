// Delas mellan webbläsaren och servern så att förhandsvisning och PDF räknar lika.
export const VAT_RATES = [25, 12, 6, 0];

export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

export const lineAmount = (item) => round2((Number(item.qty) || 0) * (Number(item.price) || 0));

export function calcTotals(items) {
  const bases = new Map();
  for (const item of items) {
    const rate = Number(item.vat) || 0;
    bases.set(rate, round2((bases.get(rate) || 0) + lineAmount(item)));
  }
  const vatGroups = [...bases]
    .sort((a, b) => b[0] - a[0])
    .map(([rate, base]) => ({ rate, base, vat: round2((base * rate) / 100) }));
  const net = round2(vatGroups.reduce((sum, g) => sum + g.base, 0));
  const vat = round2(vatGroups.reduce((sum, g) => sum + g.vat, 0));
  return { vatGroups, net, vat, total: round2(net + vat) };
}

const sek = new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK' });

// Vanliga mellanslag och bindestreck: PDF-standardtypsnitten saknar U+2212 och U+202F.
export const formatSek = (n) => sek.format(n || 0).replace(/−/g, '-').replace(/[  ]/g, ' ');

export const formatQty = (n) => String(Number(n) || 0).replace('.', ',');
