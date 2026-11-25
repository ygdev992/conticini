const KEY = 'conticini-data-v1';

export async function loadData() {
  const saved = localStorage.getItem(KEY);
  if (saved) return migrate(JSON.parse(saved));
  return resetData();
}

// Dati salvati con la vecchia struttura: le entrate non avevano il tipo.
export function migrate(data) {
  for (const i of data.incomes ?? []) {
    if (!i.type) i.type = /^stipendio/i.test(i.label ?? '') ? 'stipendio' : 'altro';
  }
  return data;
}

export async function resetData() {
  const res = await fetch('data/sample.json');
  const data = await res.json();
  saveData(data);
  return data;
}

export function saveData(data) {
  localStorage.setItem(KEY, JSON.stringify(data));
}

export function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}`;
}
