import { VAT_RATES, calcTotals, formatQty, formatSek, lineAmount } from './calc.js';

const $ = (sel) => document.querySelector(sel);

const store = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* privat läge */ }
  },
  del(key) {
    try { localStorage.removeItem(key); } catch { /* privat läge */ }
  },
};

const DEFAULT_NOTES = 'Betalningsvillkor 30 dagar. Vid försenad betalning debiteras dröjsmålsränta enligt räntelagen.';

const isoDate = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const nextNumber = (n) => n.replace(/\d+(?=\D*$)/, (d) => String(Number(d) + 1).padStart(d.length, '0'));
const parseNum = (v) => {
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const nl = (v) => esc(v).replace(/\n/g, '<br>');
const getPath = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
const setPath = (obj, path, value) => {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => o[k], obj)[last] = value;
};

function blankInvoice(prev) {
  const now = new Date();
  const due = new Date(now);
  due.setDate(due.getDate() + 30);
  return {
    number: prev ? nextNumber(prev.number) : '1001',
    date: isoDate(now),
    dueDate: isoDate(due),
    notes: prev?.notes ?? DEFAULT_NOTES,
    seller: prev ? { ...prev.seller } : { name: '', orgNr: '', vatNr: '', address: '', email: '', phone: '', bankgiro: '', fSkatt: true },
    buyer: { name: '', orgNr: '', vatNr: '', address: '', reference: '' },
    items: [{ desc: '', qty: 1, unit: 'st', price: 0, vat: 25 }],
  };
}

let config = { appName: 'Fakturaverktyget', priceSek: 99, passDays: 365, paymentsEnabled: false };
let state = store.get('invoice') || blankInvoice();
let pro = store.get('pro');

const isPro = () => Boolean(pro && pro.exp > Date.now());
const save = () => store.set('invoice', state);

function show(text, kind = 'ok') {
  const el = $('#msg');
  el.hidden = !text;
  el.className = `msg ${kind}`;
  el.textContent = text;
}

// ---------- Formulär ----------

function fillForm() {
  for (const el of document.querySelectorAll('[data-path]')) {
    const v = getPath(state, el.dataset.path);
    if (el.type === 'checkbox') el.checked = Boolean(v);
    else el.value = v ?? '';
  }
  renderItems();
}

function renderItems() {
  const wrap = $('#items');
  wrap.replaceChildren();
  state.items.forEach((it, i) => {
    const row = document.createElement('div');
    row.className = 'item';
    row.innerHTML = `
      <input data-i="${i}" data-f="desc" aria-label="Beskrivning" placeholder="Beskrivning" value="${esc(it.desc)}">
      <input data-i="${i}" data-f="qty" aria-label="Antal" inputmode="decimal" value="${esc(formatQty(it.qty))}">
      <input data-i="${i}" data-f="unit" aria-label="Enhet" value="${esc(it.unit)}">
      <input data-i="${i}" data-f="price" aria-label="À-pris" inputmode="decimal" value="${esc(formatQty(it.price))}">
      <select data-i="${i}" data-f="vat" aria-label="Moms">
        ${VAT_RATES.map((r) => `<option value="${r}"${r === it.vat ? ' selected' : ''}>${r} %</option>`).join('')}
      </select>
      <button type="button" class="remove" data-remove="${i}" aria-label="Ta bort rad"${state.items.length === 1 ? ' disabled' : ''}>×</button>`;
    wrap.append(row);
  });
}

$('#form').addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.path) {
    setPath(state, el.dataset.path, el.type === 'checkbox' ? el.checked : el.value);
  } else if (el.dataset.f) {
    const f = el.dataset.f;
    state.items[el.dataset.i][f] = ['qty', 'price', 'vat'].includes(f) ? parseNum(el.value) : el.value;
  }
  save();
  renderPreview();
});

$('#items').addEventListener('click', (e) => {
  const i = e.target.dataset?.remove;
  if (i === undefined) return;
  state.items.splice(Number(i), 1);
  save();
  renderItems();
  renderPreview();
});

$('#addItem').addEventListener('click', () => {
  const last = state.items.at(-1);
  state.items.push({ desc: '', qty: 1, unit: last?.unit || 'st', price: 0, vat: last?.vat ?? 25 });
  save();
  renderItems();
  renderPreview();
  $('#items').lastElementChild.querySelector('input').focus();
});

$('#newInvoice').addEventListener('click', () => {
  if (!confirm('Starta en ny faktura? Dina företagsuppgifter sparas.')) return;
  state = blankInvoice(state);
  save();
  fillForm();
  renderPreview();
  show('');
});

// ---------- Förhandsvisning ----------

function renderPreview() {
  const { seller: s, buyer: b } = state;
  const t = calcTotals(state.items);
  const ph = (text) => `<span class="ph">${text}</span>`;
  const rows = state.items.map((it) => `
    <tr>
      <td>${esc(it.desc) || ph('Beskrivning')}</td>
      <td class="num">${esc(formatQty(it.qty))} ${esc(it.unit)}</td>
      <td class="num">${formatSek(it.price)}</td>
      <td class="num">${it.vat} %</td>
      <td class="num">${formatSek(lineAmount(it))}</td>
    </tr>`).join('');
  const meta = [['Fakturanr', state.number], ['Fakturadatum', state.date], ['Förfallodatum', state.dueDate], ['Er referens', b.reference]]
    .filter(([, v]) => v)
    .map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');
  const footCols = [
    [s.name, s.address],
    [s.orgNr && `Org.nr ${s.orgNr}`, s.vatNr && `Momsreg.nr ${s.vatNr}`, s.fSkatt && 'Godkänd för F-skatt'],
    [s.bankgiro && `Bankgiro ${s.bankgiro}`, s.email, s.phone],
  ].map((lines) => `<div>${lines.filter(Boolean).map(nl).join('<br>')}</div>`).join('');

  $('#preview').innerHTML = `
    ${isPro() ? '' : '<div class="wm" aria-hidden="true">GRATISVERSION</div>'}
    <div class="p-head">
      <div><div class="p-seller">${esc(s.name) || ph('Ditt företag')}</div><div class="p-muted">${nl(s.address)}</div></div>
      <div class="p-title">FAKTURA</div>
    </div>
    <div class="p-meta">
      <div>
        <div class="p-label">Faktureras till</div>
        <strong>${esc(b.name) || ph('Kundens namn')}</strong>
        <div>${nl(b.address)}</div>
        ${b.orgNr ? `<div>Org.nr ${esc(b.orgNr)}</div>` : ''}
        ${b.vatNr ? `<div>Momsreg.nr ${esc(b.vatNr)}</div>` : ''}
      </div>
      <dl>${meta}</dl>
    </div>
    <table class="p-items">
      <thead><tr><th>Beskrivning</th><th class="num">Antal</th><th class="num">À-pris</th><th class="num">Moms</th><th class="num">Belopp</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="p-sum">
      <div class="p-pay">
        <div class="p-label">Betalning</div>
        ${s.bankgiro ? `<div>Bankgiro: ${esc(s.bankgiro)}</div>` : ''}
        ${state.dueDate ? `<div>Förfallodatum: ${esc(state.dueDate)}</div>` : ''}
        <div>Ange fakturanr ${esc(state.number)} vid betalning</div>
      </div>
      <table class="p-totals">
        <tr><td>Summa exkl. moms</td><td class="num">${formatSek(t.net)}</td></tr>
        ${t.vatGroups.map((g) => `<tr><td>Moms ${g.rate} % (på ${formatSek(g.base)})</td><td class="num">${formatSek(g.vat)}</td></tr>`).join('')}
        <tr class="grand"><td>Att betala</td><td class="num">${formatSek(t.total)}</td></tr>
      </table>
    </div>
    ${state.notes ? `<p class="p-notes">${nl(state.notes)}</p>` : ''}
    <div class="p-foot">${footCols}</div>
    ${isPro() ? '' : `<div class="p-brand">Skapad gratis med ${esc(config.appName)}</div>`}`;
}

// ---------- Pro / betalning ----------

function renderStatus() {
  const status = $('#status');
  const buy = $('#buy');
  if (isPro()) {
    status.innerHTML = `<span class="badge">PRO</span> till ${new Date(pro.exp).toLocaleDateString('sv-SE')} <button type="button" class="link" id="copyKey">Kopiera licensnyckel</button>`;
    $('#copyKey').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(pro.token);
        show('Licensnyckeln är kopierad. Spara den om du byter dator eller webbläsare.');
      } catch {
        prompt('Din licensnyckel:', pro.token);
      }
    });
    buy.hidden = true;
  } else {
    status.textContent = '';
    buy.hidden = false;
    buy.textContent = `Ta bort vattenstämpel – ${config.priceSek} kr`;
  }
  renderPreview();
}

function setPro(token, exp) {
  pro = { token, exp };
  store.set('pro', pro);
  renderStatus();
}

$('#buy').addEventListener('click', async () => {
  if (!config.paymentsEnabled) return show('Betalning är inte aktiverad ännu.', 'error');
  const btn = $('#buy');
  btn.disabled = true;
  try {
    const res = await fetch('/api/checkout', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) throw new Error(data.error || 'Kunde inte starta betalningen.');
    location.href = data.url;
  } catch (err) {
    show(err.message, 'error');
    btn.disabled = false;
  }
});

$('#license').addEventListener('click', async () => {
  const token = prompt('Klistra in din licensnyckel:')?.trim();
  if (!token) return;
  const res = await fetch('/api/license', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return show(data.error || 'Ogiltig licensnyckel.', 'error');
  setPro(token, data.exp);
  show('Pro är aktiverat.');
});

async function handleStripeReturn() {
  const sid = new URLSearchParams(location.search).get('session_id');
  if (!sid) return;
  history.replaceState(null, '', location.pathname);
  const res = await fetch(`/api/unlock?session_id=${encodeURIComponent(sid)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return show(data.error || 'Kunde inte verifiera betalningen.', 'error');
  setPro(data.token, data.exp);
  show('Tack för ditt köp! Vattenstämpeln är borta. Tips: kopiera licensnyckeln uppe till höger och spara den.');
}

// ---------- PDF ----------

$('#download').addEventListener('click', async () => {
  const missing = [
    [state.seller.name, 'ditt företagsnamn'],
    [state.buyer.name, 'kundens namn'],
    [state.number, 'fakturanummer'],
  ].filter(([v]) => !String(v).trim()).map(([, label]) => label);
  if (missing.length) return show(`Fyll i ${missing.join(', ')}.`, 'error');

  const btn = $('#download');
  btn.disabled = true;
  try {
    const res = await fetch('/api/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoice: state, token: isPro() ? pro.token : undefined }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Kunde inte skapa PDF.');
    }
    const watermarked = res.headers.get('X-Watermark') === '1';
    if (watermarked && isPro()) {
      pro = null;
      store.del('pro');
      renderStatus();
    }
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: `faktura-${state.number.replace(/[^\w-]/g, '_')}.pdf`,
    });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    show(watermarked
      ? `PDF nedladdad med vattenstämpel. Ta bort den för ${config.priceSek} kr.`
      : 'PDF nedladdad.', watermarked ? 'upsell' : 'ok');
  } catch (err) {
    show(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

// ---------- Start ----------

fillForm();
renderStatus();

fetch('/api/config')
  .then((res) => res.json())
  .then((data) => {
    config = data;
    $('#appName').textContent = data.appName;
    renderStatus();
  })
  .catch(() => {});

handleStripeReturn().catch(() => show('Kunde inte verifiera betalningen.', 'error'));
