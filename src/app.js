import { dueList, monthSummary, loanStatus, addMonths, incomeLabel, incomesForMonth, amountFor, INCOME_TYPES } from './engine.js';
import { OTHER_PRESET, presetsOf, categoryLabel, presetsToText, textToPresets } from './categories.js';
import { loadData, saveData, saveLocal, setAfterSave, blankData, resetData, newId, migrate } from './store.js';
import * as cloud from './cloud.js';

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
let draft = null;
let editing = null;
let amountEdit = null;
let allowedEmails = [];
let settingsSec = 'generale';
const SETTINGS_SECTIONS = { generale: 'Persone', conti: 'Conti', entrate: 'Entrate', categorie: 'Categorie', dati: 'Cloud e dati' };

const SYNC_LABEL = { locale: '', ok: '☁ sincronizzato', sync: '☁ …', offline: '☁ offline' };
cloud.onStatus((s) => { $('#sync').textContent = SYNC_LABEL[s] ?? ''; });

async function syncFromCloud() {
  const remote = await cloud.pull();
  if (remote) {
    data = migrate(remote.data);
    allowedEmails = remote.allowedEmails;
    saveLocal(data);
  } else {
    data = blankData(data);
    allowedEmails = [cloud.getEmail()];
    await cloud.push(data, allowedEmails);
    saveLocal(data);
  }
}

function viewLogin() {
  return `<form id="login" class="card"><p class="sub">Accedi per sincronizzare i dati tra i vostri telefoni.</p>
    <label>E-mail<input name="email" type="email" autocomplete="email" required></label>
    <label>Password<input name="password" type="password" minlength="6" autocomplete="current-password" required></label>
    <label class="chk"><input type="checkbox" id="show-pw"> Mostra password</label>
    <p id="login-msg" class="sub" role="status"></p>
    <button class="pri" type="submit" value="in">Accedi</button>
    <button class="act" type="submit" value="up" formnovalidate>Crea account</button></form>`;
}

async function submitLogin(f, action) {
  const v = Object.fromEntries(new FormData(f));
  const msg = (t) => { $('#login-msg').textContent = t; };
  if (!v.email || (v.password ?? '').length < 6) { msg('Inserisci e-mail e una password di almeno 6 caratteri.'); return; }
  msg('Un attimo…');
  try {
    if (action === 'up') {
      const logged = await cloud.signUp(v.email, v.password);
      if (!logged) { msg('Account creato: conferma l\'e-mail ricevuta, poi premi Accedi.'); return; }
    } else await cloud.signIn(v.email, v.password);
    await syncFromCloud();
    tab = 'mese';
    render();
  } catch (err) {
    msg(`Accesso non riuscito: ${err.message}`);
  }
}

function viewCloud() {
  if (!cloud.cloudEnabled) return '';
  const partner = allowedEmails.find((e) => e !== cloud.getEmail()) ?? '';
  return `<h2>Cloud</h2><div class="card"><p class="sub">Connesso come ${esc(cloud.getEmail() ?? '')}</p>
    <form id="partner"><label>E-mail del partner (può accedere agli stessi dati)<input name="partner" type="email" value="${esc(partner)}"></label>
      <p id="partner-msg" class="sub" role="status">${partner ? `Salvata nel cloud: ${esc(partner)}` : 'Nessun partner collegato.'}</p>
      <button class="act" type="submit">Salva partner</button></form>
    <button class="act" id="logout">Esci</button></div>`;
}

const ownerLabel = (o) => (o === 'comune' ? 'cointestato' : data.people.find((p) => p.id === o)?.name ?? o);
const accountLabel = (a) => `Conto ${ownerLabel(a.owner)}${a.bank ? ` · ${a.bank}` : ''}`;
const accName = (id) => {
  const a = data.accounts.find((x) => x.id === id);
  return a ? accountLabel(a) : id;
};

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
    <h2>Entrate</h2>
    ${incomesForMonth(data, month).map((o) => `<div class="card"><div class="riga"><span>${esc(o.label)} · ${esc(data.people.find((p) => p.id === o.personId)?.name ?? '')}</span><span class="imp">${eur(o.amount)}</span></div>
      <button class="act" data-amount="${esc(o.sourceId)}" data-akind="entrata">Cambia importo</button></div>`).join('')}
    <h2>Per categoria</h2>
    <div class="card">${s.byCategory.map((c) => `<div class="riga"><span>${esc(categoryLabel(data.categories, c.category))}</span><span class="imp">${eur(c.total)}</span></div>`).join('')}</div>
    <h2>Uscite</h2>
    ${s.expenses.map((o) => `<div class="card"><div class="riga"><span>${esc(o.label)}</span><span class="imp">${o.estimated ? '~' : ''}${eur(o.amount)}</span></div>
      <div class="sub">${esc(categoryLabel(data.categories, o.category))} · ${dayLabel(o.date)} · ${esc(accName(o.accountId))}</div>
      ${o.kind === 'carta' ? '' : `<button class="act" data-amount="${esc(o.sourceId)}">Cambia importo</button> <button class="act" data-edit="${esc(o.sourceId)}">Modifica</button> <button class="act" data-del="${esc(o.sourceId)}">Elimina</button>`}</div>`).join('')}
    ${loans ? `<h2>Prestiti</h2>${loans}` : ''}`;
}

function personOptions(selected) {
  return data.people.map((p) => `<option value="${esc(p.id)}"${p.id === selected ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
}

function viewImpostazioni() {
  const incomes = data.incomes.map((i) => `<div class="card"><div class="riga"><strong>${esc(incomeLabel(i))} · ${esc(data.people.find((p) => p.id === i.personId)?.name ?? '')}</strong>
    <button type="button" class="act" data-delinc="${esc(i.id)}">Elimina</button></div>
    <label>Tipo<select name="i:${i.id}:type" data-retype>${Object.entries(INCOME_TYPES).map(([k, v]) =>
      `<option value="${k}"${k === i.type ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
    ${i.type === 'stipendio' ? '' : `<label>Descrizione<input name="i:${i.id}:label" value="${esc(i.label ?? '')}" required></label>`}
    <label>Importo mensile (€)<input name="i:${i.id}:amount" type="number" step="0.01" min="0" value="${i.amount}" required></label>
    <label>Giorno di accredito<input name="i:${i.id}:day" type="number" min="1" max="31" value="${i.day}" required></label>
    <label>Di chi<select name="i:${i.id}:personId">${personOptions(i.personId)}</select></label>
    <label>Conto di accredito<select name="i:${i.id}:accountId">${accountOptions(i.accountId)}</select></label></div>`).join('');
  const people = data.people.map((p) => `<div class="card"><div class="riga"><strong>${esc(p.name)}</strong>
    <button type="button" class="act" data-delperson="${esc(p.id)}">Elimina</button></div>
    <label>Nome<input name="p:${p.id}" value="${esc(p.name)}" required></label></div>`).join('');
  const accs = data.accounts.map((a) => `<div class="card"><div class="riga"><strong>${esc(accountLabel(a))}</strong>
    <button type="button" class="act" data-delacc="${esc(a.id)}">Elimina</button></div>
    <label>Intestatario<select name="a:${a.id}:owner">${ownerOptions(a.owner)}</select></label>
    <label>Banca (facoltativo)<input name="a:${a.id}:bank" value="${esc(a.bank ?? '')}"></label>
    <label>Numero / IBAN (facoltativo, anche parziale)<input name="a:${a.id}:number" value="${esc(a.number ?? '')}"></label></div>`).join('');
  const cats = data.categories.map((c) => `<div class="card"><div class="riga"><strong>${esc(c.label)}</strong>
    <button type="button" class="act" data-delcat="${esc(c.id)}">Elimina</button></div>
    <label>Nome categoria<input name="c:${c.id}:label" value="${esc(c.label)}" required></label>
    <label>Voci suggerite (una per riga: nome, ogni quanti mesi, "stimato")<textarea name="c:${c.id}:presets" rows="4">${esc(presetsToText(c.presets))}</textarea></label></div>`).join('');
  const tabs = `<div class="tabs">${Object.entries(SETTINGS_SECTIONS).map(([k, v]) =>
    `<button type="button" data-sec="${k}" class="${k === settingsSec ? 'on' : ''}">${v}</button>`).join('')}</div>`;
  const save = '<button class="pri" type="submit">Salva</button>';
  const body = {
    generale: `<form id="settings">${people}<button type="button" class="act" id="add-person">+ Aggiungi persona</button>
      <p class="sub">Le spese comuni si dividono in parti uguali tra le persone.</p>${save}</form>`,
    conti: `<form id="settings">${accs}<button type="button" class="act" id="add-account">+ Aggiungi conto</button>
      <h2>Carta di credito</h2><div class="card"><label>Conto di addebito predefinito<select name="cc:holder">${accountOptions(data.creditCard.holderAccountId)}</select></label>
        <p class="sub">Puoi cambiarlo mese per mese quando inserisci il totale in "Aggiungi".</p></div>${save}</form>`,
    entrate: `<form id="settings">${incomes}<button type="button" class="act" id="add-income">+ Aggiungi entrata</button>${save}</form>`,
    categorie: `<form id="settings">${cats}<button type="button" class="act" id="add-category">+ Aggiungi categoria</button>${save}</form>`,
    dati: `${viewCloud()}
      <h2>Backup</h2>
      <div class="card"><p class="sub">Esporta un file di backup ogni tanto.</p>
        <button class="act" id="export">Esporta dati (file JSON)</button>
        <label>Importa da file (sostituisce i dati attuali)<input id="import" type="file" accept="application/json,.json"></label></div>`,
  }[settingsSec];
  return tabs + body;
}

function exportData() {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `conticini-backup-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importData(file) {
  try {
    const next = JSON.parse(await file.text());
    const ok = ['people', 'accounts', 'incomes', 'recurring', 'loans', 'creditCard', 'payments'].every((k) => k in next);
    if (!ok) throw new Error('struttura non valida');
    if (!confirm('Sostituire tutti i dati attuali con quelli del file?')) return;
    data = migrate(next);
    saveData(data);
    tab = 'mese';
    render();
  } catch (err) {
    alert(`File non valido: ${err.message}`);
  }
}

function applySettings(f) {
  for (const [k, val] of new FormData(f)) {
    if (k === 'cc:holder') { data.creditCard.holderAccountId = val; continue; }
    const [kind, id, field] = k.split(':');
    if (kind === 'i') {
      const inc = data.incomes.find((x) => x.id === id);
      inc[field] = ['amount', 'day'].includes(field) ? +val : val.trim();
      continue;
    }
    if (kind === 'c') {
      const cat = data.categories.find((x) => x.id === id);
      if (field === 'label') cat.label = val.trim();
      else cat.presets = textToPresets(val, cat.presets);
      continue;
    }
    if (kind === 'p') data.people.find((p) => p.id === id).name = val.trim();
    else data.accounts.find((a) => a.id === id)[field] = val.trim();
  }
  saveData(data);
}

function submitSettings(f) {
  applySettings(f);
  render();
}

function accountOptions(selected) {
  return data.accounts.map((a) => `<option value="${esc(a.id)}"${a.id === selected ? ' selected' : ''}>  ${esc(accountLabel(a))}</option>`).join('');
}

function ownerOptions(selected) {
  return `${personOptions(selected)}<option value="comune"${selected === 'comune' ? ' selected' : ''}>Cointestato</option>`;
}

const emptyDraft = (kind) => (kind === 'ricorrente'
  ? { category: data.categories[0]?.id ?? 'altro', preset: 'altro', label: '', amount: '', estimated: false, everyMonths: 1, startMonth: month, day: 1, accountId: data.accounts[0].id }
  : { label: '', installment: '', totalInstallments: '', remainingInstallments: '', asOfMonth: month, day: 1, accountId: data.accounts[0].id });

function applyPreset(d) {
  const p = presetsOf(data.categories, d.category).find((x) => x.id === d.preset) ?? OTHER_PRESET;
  d.label = p.id === 'altro' ? '' : p.label;
  d.everyMonths = p.every;
  d.estimated = p.estimated;
}

function readDraft(f) {
  const v = Object.fromEntries(new FormData(f));
  return { ...v, estimated: !!v.estimated };
}

const FREQUENCIES = { 1: 'Mensile', 2: 'Bimestrale', 3: 'Trimestrale', 6: 'Semestrale', 12: 'Annuale' };

function viewImporto() {
  const { sourceId, month: m } = amountEdit;
  const src = [...data.recurring, ...data.loans, ...data.incomes].find((x) => x.id === sourceId);
  const base = src.amount ?? src.installment;
  const cur = amountFor(data, sourceId, m, base);
  const name = src.label ?? incomeLabel(src);
  return `<h2>${esc(name)} · ${monthLabel(m)}</h2>
    <form id="amount-form" class="card">
      <label>Nuovo importo (€)<input name="amount" type="number" step="0.01" min="0" value="${cur.amount}" required></label>
      <label><input type="radio" name="scope" value="month" checked style="width:auto"> Solo ${monthLabel(m)} (es. bolletta reale)</label>
      <label><input type="radio" name="scope" value="from" style="width:auto"> Da ${monthLabel(m)} in poi (i mesi passati non cambiano)</label>
      <button class="pri" type="submit">Salva</button></form>
    <button class="act" id="cancel-amount">Annulla</button>`;
}

function submitAmount(f) {
  const v = Object.fromEntries(new FormData(f));
  const { sourceId, month: m } = amountEdit;
  const key = `${sourceId}|${m}`;
  data.overrides = data.overrides.filter((o) => o.key !== key);
  if (v.scope === 'month') data.overrides.push({ key, amount: +v.amount });
  else {
    data.changes = data.changes.filter((c) => !(c.sourceId === sourceId && c.from === m));
    data.changes.push({ sourceId, from: m, amount: +v.amount });
  }
  saveData(data);
  amountEdit = null;
  tab = 'mese';
  render();
}

function viewAggiungi() {
  if (amountEdit) return viewImporto();
  const kinds = { ricorrente: 'Ricorrente', prestito: 'Prestito', carta: 'Carta' };
  const tabs = editing ? '' : `<div class="tabs">${Object.entries(kinds).map(([k, v]) =>
    `<button data-kind="${k}" class="${k === addKind ? 'on' : ''}">${v}</button>`).join('')}</div>`;
  const d = draft ?? (addKind === 'carta' ? {} : emptyDraft(addKind));
  const common = `<label>Conto di addebito<select name="accountId">${accountOptions(d.accountId)}</select></label>`;
  let form;
  if (addKind === 'ricorrente') {
    const cats = data.categories.map((c) => `<option value="${esc(c.id)}"${c.id === d.category ? ' selected' : ''}>${esc(c.label)}</option>`).join('');
    const presets = presetsOf(data.categories, d.category).map((p) => `<option value="${esc(p.id)}"${p.id === d.preset ? ' selected' : ''}>${esc(p.label)}</option>`).join('');
    const freqs = { ...FREQUENCIES, [d.everyMonths]: FREQUENCIES[d.everyMonths] ?? `Ogni ${d.everyMonths} mesi` };
    form = `<label>Categoria<select name="category" data-redraft>${cats}</select></label>
      <label>Voce<select name="preset" data-redraft>${presets}</select></label>
      <label>Nome<input name="label" value="${esc(d.label)}" required></label>
      <label>Importo (€)<input name="amount" type="number" step="0.01" min="0" value="${esc(d.amount)}" required></label>
      <label><input name="estimated" type="checkbox" style="width:auto"${d.estimated ? ' checked' : ''}> Importo stimato (bolletta variabile)</label>
      <label>Frequenza<select name="everyMonths">${Object.entries(freqs).map(([k, v]) => `<option value="${k}"${+k === +d.everyMonths ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>Primo mese<input name="startMonth" type="month" value="${esc(d.startMonth)}" required></label>
      <label>Giorno del mese<input name="day" type="number" min="1" max="31" value="${esc(d.day)}" required></label>${common}`;
  } else if (addKind === 'prestito') {
    form = `<label>Nome<input name="label" value="${esc(d.label)}" required></label>
      <label>Importo rata (€)<input name="installment" type="number" step="0.01" min="0" value="${esc(d.installment)}" required></label>
      <label>Rate totali<input name="totalInstallments" type="number" min="1" value="${esc(d.totalInstallments)}" required></label>
      <label>Rate rimanenti (inclusa quella del mese)<input name="remainingInstallments" type="number" min="1" value="${esc(d.remainingInstallments)}" required></label>
      <label>Mese di riferimento<input name="asOfMonth" type="month" value="${esc(d.asOfMonth)}" required></label>
      <label>Giorno del mese<input name="day" type="number" min="1" max="31" value="${esc(d.day)}" required></label>${common}`;
  } else {
    form = `<label>Mese di spesa<input name="month" type="month" value="${addMonths(todayStr().slice(0, 7), -1)}" required></label>
      <label>Totale (€)<input name="total" type="number" step="0.01" min="0" required></label>
      <label>Conto di addebito<select name="accountId">${accountOptions(data.creditCard.holderAccountId)}</select></label>
      <p class="sub">Verrà addebitato il giorno ${data.creditCard.chargeDay} del mese dopo. Se il mese esiste già viene aggiornato.</p>`;
  }
  const title = editing ? `<h2>Modifica voce</h2>` : '';
  const footer = editing
    ? '<button class="act" id="cancel-edit">Annulla modifica</button>'
    : `<button class="act" id="clear">Inizia da zero (svuota spese di esempio)</button>
    <button class="act" id="reset">Ripristina dati di esempio</button>`;
  return `${tabs}${title}<form id="form" class="card">${form}<button class="pri" type="submit">Salva</button></form>${footer}`;
}

function submitForm(f) {
  const v = Object.fromEntries(new FormData(f));
  if (addKind === 'ricorrente') {
    const item = { label: v.label, category: v.category, amount: +v.amount, estimated: !!v.estimated,
      everyMonths: +v.everyMonths, startMonth: v.startMonth, day: +v.day, accountId: v.accountId };
    const ex = editing && data.recurring.find((r) => r.id === editing.id);
    if (ex) Object.assign(ex, item); else data.recurring.push({ id: newId('rec'), ...item });
  } else if (addKind === 'prestito') {
    const item = { label: v.label, installment: +v.installment, totalInstallments: +v.totalInstallments,
      remainingInstallments: +v.remainingInstallments, asOfMonth: v.asOfMonth, day: +v.day, accountId: v.accountId };
    const ex = editing && data.loans.find((l) => l.id === editing.id);
    if (ex) Object.assign(ex, item); else data.loans.push({ id: newId('loan'), ...item });
  } else {
    const list = data.creditCard.monthly;
    const ex = list.find((x) => x.month === v.month);
    if (ex) { ex.total = +v.total; ex.accountId = v.accountId; } else list.push({ month: v.month, total: +v.total, accountId: v.accountId });
  }
  saveData(data);
  editing = null;
  draft = null;
  tab = 'mese';
  render();
}

function startEdit(id) {
  const r = data.recurring.find((x) => x.id === id);
  const l = data.loans.find((x) => x.id === id);
  if (r) {
    const category = data.categories.some((c) => c.id === r.category) ? r.category : data.categories[0]?.id;
    addKind = 'ricorrente';
    draft = { ...r, category, preset: 'altro', amount: r.amount };
  } else if (l) {
    addKind = 'prestito';
    draft = { ...l };
  } else return;
  editing = { id };
  tab = 'aggiungi';
  render();
}

function render() {
  const locked = cloud.cloudEnabled && !cloud.signedIn();
  document.querySelector('nav').hidden = locked;
  if (locked) {
    $('#titolo').textContent = 'Conticini';
    $('#mese-nav').hidden = true;
    $('#vista').innerHTML = viewLogin();
    return;
  }
  const titles = { pagare: 'Da pagare', mese: 'Mese', aggiungi: 'Aggiungi', impostazioni: 'Impostazioni' };
  $('#titolo').textContent = titles[tab];
  $('#mese-nav').hidden = tab === 'aggiungi' || tab === 'impostazioni';
  $('#mese-label').textContent = monthLabel(month);
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  $('#vista').innerHTML = { pagare: viewPagare, mese: viewMese, aggiungi: viewAggiungi, impostazioni: viewImpostazioni }[tab]();
}

document.addEventListener('click', async (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if ((t.dataset.tab || t.dataset.sec) && $('#settings')) applySettings($('#settings'));
  if (t.dataset.tab) { tab = t.dataset.tab; draft = null; editing = null; amountEdit = null; render(); }
  else if (t.dataset.sec) { settingsSec = t.dataset.sec; render(); }
  else if (t.dataset.amount) { amountEdit = { sourceId: t.dataset.amount, month }; tab = 'aggiungi'; render(); }
  else if (t.id === 'cancel-amount') { amountEdit = null; tab = 'mese'; render(); }
  else if (t.id === 'add-person') {
    applySettings($('#settings'));
    data.people.push({ id: newId('per'), name: 'Nuova persona' });
    delete data.splitRule;
    saveData(data); render();
  } else if (t.dataset.delperson) {
    applySettings($('#settings'));
    const id = t.dataset.delperson;
    const used = data.accounts.some((a) => a.owner === id) || data.incomes.some((i) => i.personId === id);
    if (used) alert('Questa persona ha conti o entrate: cambia o elimina prima quelli.');
    else if (data.people.length > 1 && confirm('Eliminare la persona?')) {
      data.people = data.people.filter((p) => p.id !== id);
      delete data.splitRule;
      saveData(data);
    }
    render();
  }
  else if (t.id === 'add-account') {
    applySettings($('#settings'));
    data.accounts.push({ id: newId('acc'), owner: data.people[0].id, bank: '', number: '' });
    saveData(data); render();
  } else if (t.dataset.delacc) {
    applySettings($('#settings'));
    const id = t.dataset.delacc;
    const used = data.incomes.some((i) => i.accountId === id) || data.recurring.some((r) => r.accountId === id)
      || data.loans.some((l) => l.accountId === id) || data.creditCard.holderAccountId === id;
    if (used) alert('Questo conto è usato da entrate, spese, prestiti o carta: cambia prima il conto in quelle voci.');
    else if (data.accounts.length > 1 && confirm('Eliminare il conto?')) { data.accounts = data.accounts.filter((a) => a.id !== id); saveData(data); }
    render();
  }
  else if (t.id === 'add-category') {
    applySettings($('#settings'));
    data.categories.push({ id: newId('cat'), label: 'Nuova categoria', presets: [] });
    saveData(data); render();
  } else if (t.dataset.delcat && confirm('Eliminare la categoria? Le voci già inserite finiranno in "Altro".')) {
    applySettings($('#settings'));
    data.categories = data.categories.filter((c) => c.id !== t.dataset.delcat);
    saveData(data); render();
  }
  else if (t.id === 'prev') { month = addMonths(month, -1); render(); }
  else if (t.id === 'next') { month = addMonths(month, 1); render(); }
  else if (t.id === 'add-income') {
    applySettings($('#settings'));
    data.incomes.push({ id: newId('inc'), type: 'altro', label: 'Nuova entrata', personId: data.people[0].id, accountId: data.accounts[0].id, amount: 0, day: 1 });
    saveData(data); render();
  } else if (t.dataset.delinc && confirm('Eliminare questa entrata?')) {
    applySettings($('#settings'));
    data.incomes = data.incomes.filter((i) => i.id !== t.dataset.delinc);
    saveData(data); render();
  } else if (t.id === 'logout') { await cloud.signOut(); render(); }
  else if (t.id === 'export') exportData();
  else if (t.dataset.kind) { addKind = t.dataset.kind; draft = null; render(); }
  else if (t.dataset.edit) startEdit(t.dataset.edit);
  else if (t.id === 'cancel-edit') { editing = null; draft = null; tab = 'mese'; render(); }
  else if (t.dataset.pay) {
    data.payments.push({ key: t.dataset.pay, paidOn: todayStr() });
    saveData(data); render();
  } else if (t.id === 'clear' && confirm('Cancellare spese, prestiti, carta e pagamenti? Restano persone, conti e stipendi.')) {
    data.recurring = []; data.loans = []; data.payments = []; data.creditCard.monthly = [];
    saveData(data); tab = 'mese'; render();
  } else if (t.dataset.del && confirm('Eliminare questa voce da tutti i mesi?')) {
    data.recurring = data.recurring.filter((r) => r.id !== t.dataset.del);
    data.loans = data.loans.filter((l) => l.id !== t.dataset.del);
    saveData(data); render();
  } else if (t.id === 'reset' && confirm('Cancellare i tuoi dati e tornare all\'esempio?')) {
    data = await resetData(); render();
  }
});

document.addEventListener('change', (e) => {
  if (e.target.hasAttribute('data-redraft')) {
    draft = readDraft($('#form'));
    if (e.target.name === 'category') draft.preset = presetsOf(data.categories, draft.category)[0].id;
    if (e.target.name === 'category' || e.target.name === 'preset') applyPreset(draft);
    render();
    return;
  }
  if (e.target.id === 'show-pw') { document.querySelector('#login [name=password]').type = e.target.checked ? 'text' : 'password'; return; }
  if (e.target.dataset.retype !== undefined) { applySettings($('#settings')); render(); return; }
  if (e.target.id === 'import' && e.target.files[0]) importData(e.target.files[0]);
});

document.addEventListener('submit', (e) => {
  if (e.target.id === 'form') { e.preventDefault(); submitForm(e.target); }
  else if (e.target.id === 'amount-form') { e.preventDefault(); submitAmount(e.target); }
  else if (e.target.id === 'login') { e.preventDefault(); submitLogin(e.target, e.submitter?.value); }
  else if (e.target.id === 'partner') {
    e.preventDefault();
    const p = new FormData(e.target).get('partner').trim().toLowerCase();
    allowedEmails = [cloud.getEmail(), ...(p ? [p] : [])];
    const msg = $('#partner-msg');
    msg.textContent = 'Salvataggio…';
    cloud.push(data, allowedEmails)
      .then(() => { msg.textContent = p ? `Salvata nel cloud: ${p}` : 'Partner rimosso.'; })
      .catch((err) => { msg.textContent = `Errore: ${err.message}`; });
  }
  else if (e.target.id === 'settings') { e.preventDefault(); submitSettings(e.target); }
});

data = await loadData();
setAfterSave(() => cloud.schedulePush(() => data));
try {
  await cloud.init();
  if (cloud.signedIn()) await syncFromCloud();
} catch { /* offline: si usa la copia locale */ }
render();

// Al ritorno sull'app, se l'altro ha salvato nel frattempo vince il suo salvataggio più recente.
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !cloud.signedIn() || cloud.hasPending() || editing || draft || amountEdit) return;
  try {
    if (await cloud.remoteChanged()) { await syncFromCloud(); render(); }
  } catch { /* offline */ }
});
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update(); });
  });
  // Nuova versione attivata: ricarica una sola volta per usare i file aggiornati.
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    location.reload();
  });
}
