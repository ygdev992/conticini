import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  occurrencesForMonth, loanStatus, transfers, dueStatus, monthSummary, addMonths, dateInMonth, accountPlan,
} from '../src/engine.js';

const data = JSON.parse(readFileSync(new URL('../data/sample.json', import.meta.url), 'utf8'));
const labels = (m) => occurrencesForMonth(data, m).map((o) => o.sourceId);

test('accountPlan: il cointestato riceve esattamente ciò che deve pagare e i giroconti quadrano', () => {
  const d = structuredClone(data);
  d.accounts.push({ id: 'acc-lui2', owner: 'lui', bank: 'X' });
  d.recurring.push({ id: 'r-extra', label: 'Extra', amount: 100, accountId: 'acc-lui2', category: 'altro', startMonth: '2026-01', everyMonths: 1, day: 3 });
  const plan = accountPlan(d, '2026-03');
  const by = (id) => plan.find((p) => p.accountId === id);
  assert.equal(by('acc-lui2').in.find((t) => t.accountId === 'acc-lui').amount, 100);
  assert.equal(by('acc-comune').balanceChange, 0);
  assert.equal(by('acc-comune').in.reduce((s, t) => s + t.amount, 0), by('acc-comune').debits);
});

test('frequenze: mensile, bimestrale, trimestrale, annuale', () => {
  const nov = labels('2026-11');
  assert.ok(nov.includes('rec-mutuo'));
  assert.ok(nov.includes('rec-luce'));   // gen, mar, ..., nov
  assert.ok(!nov.includes('rec-gas'));
  assert.ok(!nov.includes('rec-condominio'));
  assert.ok(labels('2026-10').includes('rec-condominio'));
  assert.ok(labels('2027-03').includes('rec-polizza-casa'));
  assert.ok(!labels('2026-04').includes('rec-polizza-casa'));
});

test('giorno limitato alla fine del mese', () => {
  assert.equal(dateInMonth('2027-02', 30), '2027-02-28');
  assert.equal(addMonths('2026-12', 1), '2027-01');
});

test('prestiti: rate rimanenti, debito residuo, data fine', () => {
  const l = data.loans.find((x) => x.id === 'loan-cucina');
  const st = loanStatus(l, '2026-11');
  assert.equal(st.remaining, 9);
  assert.equal(st.residualDebt, 1350);
  assert.equal(st.endMonth, '2027-07');
  assert.equal(loanStatus(l, '2027-07').remaining, 1);
  assert.equal(loanStatus(l, '2027-08').active, false);
  assert.equal(loanStatus(l, '2026-10').active, false);
  assert.ok(!labels('2027-08').includes('loan-cucina'));
});

test('carta: spesa del mese precedente addebitata il giorno 5 sul conto del titolare', () => {
  const cc = occurrencesForMonth(data, '2026-11').find((o) => o.sourceId === 'cc');
  assert.equal(cc.amount, 702.15);
  assert.equal(cc.date, '2026-11-05');
  assert.equal(cc.accountId, 'acc-lei');
  assert.equal(occurrencesForMonth(data, '2026-08').some((o) => o.sourceId === 'cc'), false);
});

test('giroconti: totale/2 - uscite sui propri conti, somma = uscite sul cointestato', () => {
  const t = transfers(data, '2026-11');
  const occs = occurrencesForMonth(data, '2026-11');
  const comune = occs.filter((o) => o.accountId === 'acc-comune').reduce((s, o) => s + o.amount, 0);
  const { lui, lei } = t.people;
  assert.equal(Math.round((lui.contribution + lei.contribution) * 100) / 100, Math.round(comune * 100) / 100);
  assert.equal(lui.share, lei.share);
  assert.equal(lui.ownExpenses, 285);
  assert.equal(lei.ownExpenses, 150 + 702.15);
});

test('carta: conto di addebito scelto per singolo mese', () => {
  const custom = structuredClone(data);
  custom.creditCard.monthly.find((m) => m.month === '2026-10').accountId = 'acc-lui';
  assert.equal(occurrencesForMonth(custom, '2026-11').find((o) => o.sourceId === 'cc').accountId, 'acc-lui');
  assert.equal(occurrencesForMonth(custom, '2026-12').find((o) => o.sourceId === 'cc').accountId, 'acc-lei');
  const t = transfers(custom, '2026-11');
  assert.equal(t.people.lui.ownExpenses, 285 + 702.15);
});

test('giroconto negativo: il cointestato gira alla persona', () => {
  const custom = { ...data, recurring: [], loans: [], creditCard: { ...data.creditCard, monthly: [{ month: '2026-10', total: 1000 }] } };
  const t = transfers(custom, '2026-11');
  assert.equal(t.people.lei.contribution, -500);
  assert.equal(t.people.lei.direction, 'riceve');
  assert.equal(t.people.lui.contribution, 500);
});

test('dueStatus', () => {
  const occ = { key: 'x|2026-11', date: '2026-11-20' };
  assert.equal(dueStatus(occ, '2026-11-25'), 'scaduto');
  assert.equal(dueStatus(occ, '2026-11-15'), 'in_scadenza');
  assert.equal(dueStatus(occ, '2026-11-01'), 'futuro');
  assert.equal(dueStatus(occ, '2026-11-25', [{ key: 'x|2026-11' }]), 'pagato');
});

test('entrate: lo stipendio ha etichetta fissa, le altre voci la propria descrizione', () => {
  const custom = structuredClone(data);
  custom.incomes.push({ id: 'inc-x', type: 'altro', label: 'Affitto box', personId: 'lei', accountId: 'acc-lei', amount: 100, day: 5 });
  const labelsOut = monthSummary(custom, '2026-11').incomes.map((i) => i.label);
  assert.deepEqual(labelsOut, ['Stipendio', 'Stipendio', 'Affitto box']);
});

test('categorie: ogni uscita ha la sua e i totali per categoria tornano', () => {
  const s = monthSummary(data, '2026-11');
  const cat = (id) => s.expenses.find((o) => o.sourceId === id).category;
  assert.equal(cat('rec-luce'), 'utenze');
  assert.equal(cat('loan-cucina'), 'finanziamenti');
  assert.equal(cat('cc'), 'carta');
  const sum = s.byCategory.reduce((a, c) => a + c.total, 0);
  assert.equal(Math.round(sum * 100) / 100, s.totalExpenses);
});

test('storico importi: variazione da un mese in poi e override del singolo mese', () => {
  const d = structuredClone(data);
  const luce = d.recurring.find((r) => r.id === 'rec-luce');
  const base = luce.amount;
  const at = (m) => occurrencesForMonth(d, m).find((o) => o.sourceId === 'rec-luce');
  d.changes = [{ sourceId: 'rec-luce', from: '2026-11', amount: base + 10 }];
  d.overrides = [{ key: 'rec-luce|2026-11', amount: 1 }];
  assert.equal(at('2026-09').amount, base);
  assert.equal(at('2026-11').amount, 1);
  assert.equal(at('2026-11').estimated, false);
  d.overrides = [];
  assert.equal(at('2026-11').amount, base + 10);
  assert.equal(at('2027-01').amount, base + 10);
  assert.equal(at('2026-09').amount, base);
});

test('riepilogo mese', () => {
  const s = monthSummary(data, '2026-11');
  assert.equal(s.totalIncome, 3900);
  assert.equal(Math.round((s.totalIncome - s.totalExpenses) * 100) / 100, s.remaining);
});
