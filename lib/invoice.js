import { VAT_RATES } from '../public/calc.js';

export class InvoiceError extends Error {}

const str = (v, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function num(v, label) {
  const n = Number(v);
  if (!Number.isFinite(n) || Math.abs(n) > 1e9) throw new InvoiceError(`Ogiltigt värde för ${label}.`);
  return n;
}

export function parseInvoice(input) {
  if (!input || typeof input !== 'object') throw new InvoiceError('Fakturan saknas.');
  const s = input.seller || {};
  const b = input.buyer || {};
  const items = Array.isArray(input.items) ? input.items : [];
  if (items.length < 1 || items.length > 100) throw new InvoiceError('Fakturan måste ha 1–100 rader.');

  const invoice = {
    number: str(input.number, 40),
    date: str(input.date, 10),
    dueDate: str(input.dueDate, 10),
    notes: str(input.notes, 1000),
    seller: {
      name: str(s.name),
      orgNr: str(s.orgNr, 20),
      vatNr: str(s.vatNr, 20),
      address: str(s.address, 300),
      email: str(s.email),
      phone: str(s.phone, 30),
      bankgiro: str(s.bankgiro, 40),
      fSkatt: Boolean(s.fSkatt),
    },
    buyer: {
      name: str(b.name),
      orgNr: str(b.orgNr, 20),
      vatNr: str(b.vatNr, 20),
      address: str(b.address, 300),
      reference: str(b.reference),
    },
    items: items.map((it, i) => {
      const vat = Number(it?.vat);
      if (!VAT_RATES.includes(vat)) throw new InvoiceError(`Ogiltig momssats på rad ${i + 1}.`);
      return {
        desc: str(it.desc, 200),
        qty: num(it.qty, `antal på rad ${i + 1}`),
        unit: str(it.unit, 10),
        price: num(it.price, `pris på rad ${i + 1}`),
        vat,
      };
    }),
  };

  if (!invoice.seller.name) throw new InvoiceError('Ange ditt företagsnamn.');
  if (!invoice.buyer.name) throw new InvoiceError('Ange kundens namn.');
  if (!invoice.number) throw new InvoiceError('Ange fakturanummer.');
  return invoice;
}
