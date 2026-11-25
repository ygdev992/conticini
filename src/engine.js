// Motore di calcolo puro: nessun accesso a DOM o storage.

export const DUE_SOON_DAYS = 7;

const round2 = (n) => Math.round(n * 100) / 100;

export function parseMonth(m) {
  const [y, mo] = m.split('-').map(Number);
  return { y, mo };
}

export function monthIndex(m) {
  const { y, mo } = parseMonth(m);
  return y * 12 + (mo - 1);
}

export function addMonths(m, n) {
  const i = monthIndex(m) + n;
  const y = Math.floor(i / 12);
  return `${y}-${String((i % 12) + 1).padStart(2, '0')}`;
}

export function monthOf(dateStr) {
  return dateStr.slice(0, 7);
}

export function dateInMonth(m, day) {
  const { y, mo } = parseMonth(m);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return `${m}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

export function occurrenceKey(sourceId, month) {
  return `${sourceId}|${month}`;
}

export function loanStatus(loan, month) {
  const idx = monthIndex(month) - monthIndex(loan.asOfMonth);
  const remainingBefore = loan.remainingInstallments - idx; // rate ancora da pagare, inclusa quella del mese
  const active = remainingBefore > 0 && idx >= 0;
  const remaining = Math.max(0, Math.min(loan.remainingInstallments, remainingBefore));
  return {
    active,
    remaining,
    paid: loan.totalInstallments - remaining,
    residualDebt: round2(remaining * loan.installment),
    endMonth: addMonths(loan.asOfMonth, loan.remainingInstallments - 1),
  };
}

// Storico importi: `overrides` vale per un solo mese (importo reale), `changes` da un mese in poi.
export function amountFor(data, sourceId, month, base) {
  const ov = (data.overrides ?? []).find((o) => o.key === occurrenceKey(sourceId, month));
  if (ov) return { amount: ov.amount, overridden: true };
  const ch = (data.changes ?? []).filter((c) => c.sourceId === sourceId && c.from <= month)
    .sort((a, b) => b.from.localeCompare(a.from))[0];
  return { amount: ch ? ch.amount : base, overridden: false };
}

export function occurrencesForMonth(data, month) {
  const out = [];

  for (const r of data.recurring ?? []) {
    const diff = monthIndex(month) - monthIndex(r.startMonth);
    if (diff < 0 || diff % r.everyMonths !== 0) continue;
    const a = amountFor(data, r.id, month, r.amount);
    out.push({
      key: occurrenceKey(r.id, month), sourceId: r.id, kind: 'ricorrente', label: r.label,
      amount: a.amount, estimated: !!r.estimated && !a.overridden, date: dateInMonth(month, r.day), accountId: r.accountId, category: r.category ?? 'altro',
    });
  }

  for (const l of data.loans ?? []) {
    const st = loanStatus(l, month);
    if (!st.active) continue;
    out.push({
      key: occurrenceKey(l.id, month), sourceId: l.id, kind: 'prestito',
      label: `${l.label} (${st.paid + 1}/${l.totalInstallments})`,
      amount: amountFor(data, l.id, month, l.installment).amount, estimated: false, date: dateInMonth(month, l.day), accountId: l.accountId, category: 'finanziamenti',
    });
  }

  // La spesa del mese M viene addebitata il giorno chiave del mese M+1: qui cerchiamo la spesa del mese precedente.
  const cc = data.creditCard;
  if (cc) {
    const prev = cc.monthly?.find((x) => x.month === addMonths(month, -1));
    if (prev) {
      out.push({
        key: occurrenceKey('cc', month), sourceId: 'cc', kind: 'carta', label: `${cc.label} (spese ${prev.month})`,
        amount: prev.total, estimated: false, date: dateInMonth(month, cc.chargeDay ?? 5), accountId: prev.accountId ?? cc.holderAccountId, category: 'carta',
      });
    }
  }

  return out.sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));
}

export const INCOME_TYPES = { stipendio: 'Stipendio', altro: 'Altra entrata' };

export function incomeLabel(i) {
  if (i.type === 'stipendio') return 'Stipendio';
  return i.label || 'Entrata';
}

export function incomesForMonth(data, month) {
  return (data.incomes ?? []).map((i) => ({
    key: occurrenceKey(i.id, month), sourceId: i.id, type: i.type, label: incomeLabel(i), personId: i.personId,
    amount: amountFor(data, i.id, month, i.amount).amount, date: dateInMonth(month, i.day), accountId: i.accountId,
  }));
}

export function dueStatus(occ, today, payments = []) {
  const paid = payments.some((p) => p.key === occ.key);
  if (paid) return 'pagato';
  if (occ.date < today) return 'scaduto';
  const days = Math.round((Date.parse(occ.date) - Date.parse(today)) / 86400000);
  return days <= DUE_SOON_DAYS ? 'in_scadenza' : 'futuro';
}

// Contributo al cointestato = quota del totale - uscite sui propri conti. Negativo: il cointestato gira soldi alla persona.
export function transfers(data, month) {
  const occs = occurrencesForMonth(data, month);
  const total = occs.reduce((s, o) => s + o.amount, 0);
  const owners = new Map(data.accounts.map((a) => [a.id, a.owner]));
  const split = data.splitRule ?? {};
  const result = { month, total: round2(total), people: {} };

  const raw = data.people.map((p) => {
    const share = total * (split[p.id] ?? 1 / data.people.length);
    const own = occs.filter((o) => owners.get(o.accountId) === p.id).reduce((s, o) => s + o.amount, 0);
    return { p, share, own, contribution: share - own };
  });
  // L'ultimo assorbe l'arrotondamento al centesimo, così i giroconti sommano esattamente.
  const targetSum = round2(raw.reduce((s, r) => s + r.contribution, 0));
  let assigned = 0;
  raw.forEach((r, i) => {
    const contribution = i === raw.length - 1 ? round2(targetSum - assigned) : round2(r.contribution);
    assigned += contribution;
    result.people[r.p.id] = {
      name: r.p.name, share: round2(r.share), ownExpenses: round2(r.own), contribution,
      direction: contribution >= 0 ? 'versa' : 'riceve',
    };
  });
  return result;
}

export function totalsByCategory(expenses) {
  const map = new Map();
  for (const o of expenses) map.set(o.category, (map.get(o.category) ?? 0) + o.amount);
  return [...map].map(([category, total]) => ({ category, total: round2(total) })).sort((a, b) => b.total - a.total);
}

export function monthSummary(data, month) {
  const incomes = incomesForMonth(data, month);
  const expenses = occurrencesForMonth(data, month);
  const totalIncome = round2(incomes.reduce((s, i) => s + i.amount, 0));
  const totalExpenses = round2(expenses.reduce((s, o) => s + o.amount, 0));
  return {
    month, incomes, expenses, totalIncome, totalExpenses, byCategory: totalsByCategory(expenses),
    remaining: round2(totalIncome - totalExpenses),
    transfers: transfers(data, month),
  };
}

export function dueList(data, month, today) {
  return occurrencesForMonth(data, month)
    .map((o) => ({ ...o, status: dueStatus(o, today, data.payments) }));
}
