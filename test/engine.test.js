import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  occurrencesForMonth, loanStatus, transfers, dueStatus, monthSummary, addMonths, dateInMonth,
} from '../src/engine.js';

const data = JSON.parse(readFileSync(new URL('../data/sample.json', import.meta.url), 'utf8'));
const labels = (m) => occurrencesForMonth(data, m).map((o) => o.sourceId);

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

test('riepilogo mese', () => {
  const s = monthSummary(data, '2026-11');
  assert.equal(s.totalIncome, 3900);
  assert.equal(Math.round((s.totalIncome - s.totalExpenses) * 100) / 100, s.remaining);
});
