import { dueList, monthSummary, loanStatus, addMonths } from './engine.js';
import { loadData, saveData, resetData, newId } from './store.js';

const $ = (s) => document.querySelector(s);
const eur = (n) => n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const monthLabel = (m) => new Date(`${m}-01T12:00:00`).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
const dayLabel = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
const STATUS = { scaduto: 'Scaduto', in_scadenza: 'In scadenza', pagato: 'Pagato', futuro: 'Da pagare' };

let data;
let tab = 'pagare';
let month = todayStr().slice(0, 7);
let addKind = 'ricorrente';

const accName = (id) => data.accounts.find((a) => a.id === id)?.name ?? id;

function viewPagare() {
  const today = todayStr();
  // Includiamo il mese precedente per non perdere le scadenze arretrate non pagate.
  const all = [...dueList(data, addMonths(month, -1), today), ...dueList(data, month, today)];
  const order = { scaduto: 0, in_scadenza: 1, futuro: 2, pagato: 3 };
  all.sort((a, b) => order[a.status] - order[b.status] || a.date.localeCompare(b.date));
  const visible = all.filter((o) => o.status !== 'pagato' || o.date.startsWith(month));
  if (!visible.length) return '<p class="sub">Niente da pagare.</p>';
  return visible.map((o) => `
    <div class="card st-${o.status}">
      <div class="riga"><strong>${esc(o.label)}</strong><span class="imp">${o.estimated ? '~' : ''}${eur(o.amount)}</span></div>
      <div class="riga"><span class="sub">${dayLabel(o.date)} · ${esc(accName(o.accountId))}</span>
        <span class="badge ${o.status}">${STATUS[o.status]}</span></div>
      ${o.status === 'pagato' ? '' : `<button class="act" data-pay="${esc(o.key)}">Segna pagato</button>`}
    </div>`).join('');
}

function viewMese() {
  const s = monthSummary(data, month);
  const t = s.transfers;
  const giro = Object.values(t.people).map((p) => {
    const txt = p.contribution >= 0
      ? `${esc(p.name)} versa <strong>${eur(p.contribution)}</strong> al cointestato`
      : `Il cointestato gira <strong>${eur(-p.contribution)}</strong> a ${esc(p.name)}`;
    return `<div class="card"><div>${txt}</div>
      <div class="sub">quota ${eur(p.share)} − uscite sui propri conti ${eur(p.ownExpenses)}</div></div>`;
  }).join('');
  const loans = data.loans.map((l) => ({ l, st: loanStatus(l, month) })).filter((x) => x.st.active).map(({ l, st }) => `
    <div class="card"><div class="riga"><strong>${esc(l.label)}</strong><span class="imp">${eur(l.installment)}</span></div>
      <div class="sub">rate rimaste ${st.remaining}/${l.totalInstallments} · debito residuo ${eur(st.residualDebt)} · fine ${monthLabel(st.endMonth)}</div></div>`).join('');
  return `
    <div class="card">
      <div class="riga"><span>Entrate</span><span class="imp">${eur(s.totalIncome)}</span></div>
      <div class="riga"><span>Uscite</span><span class="imp">${eur(s.totalExpenses)}</span></div>
      <hr>
      <div class="sub">Quanto resta</div>
      <div class="grande ${s.remaining >= 0 ? 'pos' : 'neg'}">${eur(s.remaining)}</div>
    </div>
    <h2>Giroconti del mese</h2>${giro}
    <h2>Uscite</h2>
    ${s.expenses.map((o) => `<div class="card"><div class="riga"><span>${esc(o.label)}</span><span class="imp">${o.estimated ? '~' : ''}${eur(o.amount)}</span></div>
      <div class="sub">${dayLabel(o.date)} · ${esc(accName(o.accountId))}</div></div>`).join('')}
    ${loans ? `<h2>Prestiti</h2>${loans}` : ''}`;
}

function accountOptions() {
  return data.accounts.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('');
}

function viewAggiungi() {
  const kinds = { ricorrente: 'Ricorrente', prestito: 'Prestito', carta: 'Carta' };
  const tabs = `<div class="tabs">${Object.entries(kinds).map(([k, v]) =>
    `<button data-kind="${k}" class="${k === addKind ? 'on' : ''}">${v}</button>`).join('')}</div>`;
  const common = `<label>Conto di addebito<select name="accountId">${accountOptions()}</select></label>`;
  let form;
  if (addKind === 'ricorrente') {
    form = `<label>Nome<input name="label" required></label>
      <label>Importo (€)<input name="amount" type="number" step="0.01" min="0" required></label>
      <label><input name="estimated" type="checkbox" style="width:auto"> Importo stimato</label>
      <label>Frequenza<select name="everyMonths"><option value="1">Mensile</option><option value="2">Bimestrale</option>
        <option value="3">Trimestrale</option><option value="12">Annuale</option></select></label>
      <label>Primo mese<input name="startMonth" type="month" value="${month}" required></label>
      <label>Giorno del mese<input name="day" type="number" min="1" max="31" value="1" required></label>${common}`;
  } else if (addKind === 'prestito') {
    form = `<label>Nome<input name="label" required></label>
      <label>Importo rata (€)<input name="installment" type="number" step="0.01" min="0" required></label>
      <label>Rate totali<input name="totalInstallments" type="number" min="1" required></label>
      <label>Rate rimanenti (inclusa quella del mese)<input name="remainingInstallments" type="number" min="1" required></label>
      <label>Mese di riferimento<input name="asOfMonth" type="month" value="${month}" required></label>
      <label>Giorno del mese<input name="day" type="number" min="1" max="31" value="1" required></label>${common}`;
  } else {
    form = `<label>Mese di spesa<input name="month" type="month" value="${addMonths(todayStr().slice(0, 7), -1)}" required></label>
      <label>Totale (€)<input name="total" type="number" step="0.01" min="0" required></label>
      <p class="sub">Verrà addebitato il giorno ${data.creditCard.chargeDay} del mese dopo sul conto di ${esc(accName(data.creditCard.holderAccountId))}. Se il mese esiste già viene aggiornato.</p>`;
  }
  return `${tabs}<form id="form" class="card">${form}<button class="pri" type="submit">Salva</button></form>
    <button class="act" id="reset">Ripristina dati di esempio</button>`;
}

function submitForm(f) {
  const v = Object.fromEntries(new FormData(f));
  if (addKind === 'ricorrente') {
    data.recurring.push({ id: newId('rec'), label: v.label, category: 'altro', amount: +v.amount, estimated: !!v.estimated,
      everyMonths: +v.everyMonths, startMonth: v.startMonth, day: +v.day, accountId: v.accountId });
  } else if (addKind === 'prestito') {
    data.loans.push({ id: newId('loan'), label: v.label, installment: +v.installment, totalInstallments: +v.totalInstallments,
      remainingInstallments: +v.remainingInstallments, asOfMonth: v.asOfMonth, day: +v.day, accountId: v.accountId });
  } else {
    const list = data.creditCard.monthly;
    const ex = list.find((x) => x.month === v.month);
    if (ex) ex.total = +v.total; else list.push({ month: v.month, total: +v.total });
  }
  saveData(data);
  tab = 'mese';
  render();
}

function render() {
  const titles = { pagare: 'Da pagare', mese: 'Mese', aggiungi: 'Aggiungi' };
  $('#titolo').textContent = titles[tab];
  $('#mese-nav').hidden = tab === 'aggiungi';
  $('#mese-label').textContent = monthLabel(month);
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  $('#vista').innerHTML = { pagare: viewPagare, mese: viewMese, aggiungi: viewAggiungi }[tab]();
}

document.addEventListener('click', async (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.tab) { tab = t.dataset.tab; render(); }
  else if (t.id === 'prev') { month = addMonths(month, -1); render(); }
  else if (t.id === 'next') { month = addMonths(month, 1); render(); }
  else if (t.dataset.kind) { addKind = t.dataset.kind; render(); }
  else if (t.dataset.pay) {
    data.payments.push({ key: t.dataset.pay, paidOn: todayStr() });
    saveData(data); render();
  } else if (t.id === 'reset' && confirm('Cancellare i tuoi dati e tornare all\'esempio?')) {
    data = await resetData(); render();
  }
});

document.addEventListener('submit', (e) => {
  if (e.target.id === 'form') { e.preventDefault(); submitForm(e.target); }
});

data = await loadData();
render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
