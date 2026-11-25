import { defaultCategories } from './categories.js';

const KEY = 'conticini-data-v1';

export async function loadData() {
  const saved = localStorage.getItem(KEY);
  if (saved) return migrate(JSON.parse(saved));
  return resetData();
}

// Dati salvati con la vecchia struttura: le entrate non avevano il tipo, mancavano categorie e storico importi.
export function migrate(data) {
  for (const i of data.incomes ?? []) {
    if (!i.type) i.type = /^stipendio/i.test(i.label ?? '') ? 'stipendio' : 'altro';
  }
  data.categories ??= defaultCategories();
  data.changes ??= [];
  data.overrides ??= [];
  return data;
}

export async function resetData() {
  const res = await fetch('data/sample.json');
  const data = migrate(await res.json());
  saveData(data);
  return data;
}

let afterSave = null;
export const setAfterSave = (fn) => { afterSave = fn; };

export function saveData(data) {
  saveLocal(data);
  afterSave?.(data);
}

export function saveLocal(data) {
  localStorage.setItem(KEY, JSON.stringify(data));
}

// Dati vuoti per partire da zero: restano persone, conti, entrate e categorie da personalizzare.
export function blankData(data) {
  return { ...data, recurring: [], loans: [], payments: [], changes: [], overrides: [], creditCard: { ...data.creditCard, monthly: [] } };
}

export function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}`;
}
