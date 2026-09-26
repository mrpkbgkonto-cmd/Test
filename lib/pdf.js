import PDFDocument from 'pdfkit';
import { calcTotals, formatQty, formatSek, lineAmount } from '../public/calc.js';

const DARK = '#111827';
const GRAY = '#6b7280';
const LINE = '#e5e7eb';
const HEAD_BG = '#f3f4f6';
const M = 50;
const CONTENT_BOTTOM = 110; // plats reserverad för sidfoten

export function renderInvoicePdf(inv, { watermark = true, appName = 'Fakturaverktyget', brandUrl = '', compress = true } = {}) {
  const doc = new PDFDocument({
    size: 'A4',
    margin: M,
    bufferPages: true,
    compress,
    info: { Title: `Faktura ${inv.number}`, Author: inv.seller.name, Creator: appName },
  });
  const L = M;
  const R = doc.page.width - M;
  const W = R - L;
  const maxY = () => doc.page.height - CONTENT_BOTTOM;
  const { seller: s, buyer: b } = inv;
  const totals = calcTotals(inv.items);

  // Sidhuvud
  doc.font('Helvetica-Bold').fontSize(18).fillColor(DARK).text(s.name, L, M, { width: W * 0.6 });
  if (s.address) doc.font('Helvetica').fontSize(9).fillColor(GRAY).text(s.address, { width: W * 0.6 });
  const headerBottom = doc.y;
  doc.font('Helvetica-Bold').fontSize(22).fillColor(DARK).text('FAKTURA', L, M, { width: W, align: 'right' });

  const top = Math.max(130, headerBottom + 25);

  // Fakturauppgifter (höger)
  const mx = L + W * 0.58;
  let my = top;
  const meta = [
    ['Fakturanummer', inv.number],
    ['Fakturadatum', inv.date],
    ['Förfallodatum', inv.dueDate],
    ['Er referens', b.reference],
  ].filter(([, v]) => v);
  for (const [k, v] of meta) {
    doc.font('Helvetica').fontSize(9).fillColor(GRAY).text(k, mx, my, { width: 90 });
    doc.font('Helvetica-Bold').fillColor(DARK).text(v, mx + 90, my, { width: R - mx - 90, align: 'right' });
    my += 16;
  }

  // Kund (vänster)
  doc.font('Helvetica').fontSize(8).fillColor(GRAY).text('FAKTURERAS TILL', L, top);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(DARK).text(b.name, L, doc.y + 3, { width: W * 0.5 });
  doc.font('Helvetica').fontSize(9.5);
  for (const line of [b.address, b.orgNr && `Org.nr ${b.orgNr}`, b.vatNr && `Momsreg.nr ${b.vatNr}`].filter(Boolean)) {
    doc.text(line, { width: W * 0.5 });
  }

  // Rader
  const cols = [
    { label: 'Beskrivning', x: L, w: 195, align: 'left', val: (it) => it.desc },
    { label: 'Antal', x: L + 200, w: 45, align: 'right', val: (it) => formatQty(it.qty) },
    { label: 'Enhet', x: L + 250, w: 35, align: 'left', val: (it) => it.unit },
    { label: 'À-pris', x: L + 290, w: 75, align: 'right', val: (it) => formatSek(it.price) },
    { label: 'Moms', x: L + 370, w: 35, align: 'right', val: (it) => `${it.vat} %` },
    { label: 'Belopp', x: L + 410, w: 85, align: 'right', val: (it) => formatSek(lineAmount(it)) },
  ];

  const drawTableHead = (y) => {
    doc.rect(L, y, W, 20).fill(HEAD_BG);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(GRAY);
    for (const c of cols) doc.text(c.label, c.x + (c.align === 'left' ? 4 : 0), y + 6, { width: c.w - 4, align: c.align });
    return y + 24;
  };

  let y = drawTableHead(Math.max(my, doc.y) + 30);
  doc.font('Helvetica').fontSize(9.5);
  for (const it of inv.items) {
    const h = Math.max(doc.heightOfString(it.desc || ' ', { width: cols[0].w - 4 }), 12) + 8;
    if (y + h > maxY()) {
      doc.addPage();
      y = drawTableHead(M);
      doc.font('Helvetica').fontSize(9.5);
    }
    doc.fillColor(DARK);
    for (const c of cols) doc.text(c.val(it), c.x + (c.align === 'left' ? 4 : 0), y + 3, { width: c.w - 4, align: c.align });
    y += h;
    doc.moveTo(L, y).lineTo(R, y).lineWidth(0.5).strokeColor(LINE).stroke();
  }

  // Summering
  const totalsHeight = (totals.vatGroups.length + 2) * 16 + 30;
  if (y + totalsHeight > maxY()) {
    doc.addPage();
    y = M;
  }
  y += 14;
  const tx = L + 200;
  const tw = W - 200;
  const totalRow = (label, value, bold = false) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 12 : 9.5).fillColor(DARK);
    doc.text(label, tx, y, { width: tw - 95 });
    doc.text(value, tx + tw - 95, y, { width: 95, align: 'right' });
    y += bold ? 20 : 16;
  };

  // Betalningsinformation (vänster om summan)
  const payTop = y;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(GRAY).text('BETALNING', L, payTop);
  doc.font('Helvetica').fontSize(9.5).fillColor(DARK);
  for (const line of [
    s.bankgiro && `Bankgiro: ${s.bankgiro}`,
    inv.dueDate && `Förfallodatum: ${inv.dueDate}`,
    `Ange fakturanr ${inv.number} vid betalning`,
  ].filter(Boolean)) {
    doc.text(line, L, doc.y + 2, { width: 180 });
  }
  const payBottom = doc.y;

  totalRow('Summa exkl. moms', formatSek(totals.net));
  for (const g of totals.vatGroups) totalRow(`Moms ${g.rate} % (på ${formatSek(g.base)})`, formatSek(g.vat));
  doc.moveTo(tx, y).lineTo(R, y).lineWidth(1).strokeColor(DARK).stroke();
  y += 8;
  totalRow('Att betala', formatSek(totals.total), true);
  y = Math.max(y, payBottom) + 20;

  if (inv.notes) {
    doc.font('Helvetica').fontSize(9).fillColor(GRAY);
    if (y + doc.heightOfString(inv.notes, { width: W }) > maxY()) {
      doc.addPage();
      y = M;
    }
    doc.text(inv.notes, L, y, { width: W });
  }

  // Sidfot, sidnummer och vattenstämpel på varje sida
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0; // annars skapar text nära kanten en ny sida
    const fy = doc.page.height - 95;
    doc.moveTo(L, fy).lineTo(R, fy).lineWidth(0.5).strokeColor(LINE).stroke();
    const colW = W / 3 - 8;
    const foot = [
      [s.name, s.address],
      [s.orgNr && `Org.nr ${s.orgNr}`, s.vatNr && `Momsreg.nr ${s.vatNr}`, s.fSkatt && 'Godkänd för F-skatt'],
      [s.bankgiro && `Bankgiro ${s.bankgiro}`, s.email, s.phone],
    ];
    foot.forEach((lines, c) => {
      doc.font('Helvetica').fontSize(8).fillColor(GRAY).text(lines.filter(Boolean).join('\n'), L + c * (W / 3), fy + 8, { width: colW });
    });
    if (range.count > 1) {
      doc.fontSize(8).fillColor(GRAY).text(`Sida ${i - range.start + 1} av ${range.count}`, L, doc.page.height - 38, { width: W, align: 'right' });
    }
    if (watermark) {
      doc.fontSize(7.5).fillColor(GRAY).text(`Skapad gratis med ${appName}${brandUrl ? ` – ${brandUrl}` : ''}`, L, doc.page.height - 38, { width: W, align: 'left' });
      doc.save();
      doc.rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] });
      doc.opacity(0.18).font('Helvetica-Bold').fontSize(64).fillColor('#9ca3af');
      doc.text('GRATISVERSION', 0, doc.page.height / 2 - 32, { width: doc.page.width, align: 'center' });
      doc.restore();
    }
  }

  doc.end();
  return doc;
}
