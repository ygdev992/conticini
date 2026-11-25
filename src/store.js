const KEY = 'conticini-data-v1';

export async function loadData() {
  const saved = localStorage.getItem(KEY);
  if (saved) return JSON.parse(saved);
  return resetData();
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
