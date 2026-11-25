// Categorie delle uscite ricorrenti. Ogni voce suggerita precompila nome, frequenza e "stimato".
export const CATEGORIES = {
  casa: { label: 'Casa', presets: [
    { id: 'mutuo', label: 'Mutuo', every: 1, estimated: false },
    { id: 'affitto', label: 'Affitto', every: 1, estimated: false },
    { id: 'condominio', label: 'Condominio', every: 3, estimated: false },
  ] },
  utenze: { label: 'Utenze', presets: [
    { id: 'luce', label: 'Luce', every: 2, estimated: true },
    { id: 'gas', label: 'Gas', every: 2, estimated: true },
    { id: 'acqua', label: 'Acqua', every: 3, estimated: true },
    { id: 'internet', label: 'Internet', every: 1, estimated: false },
    { id: 'telefono', label: 'Telefono', every: 1, estimated: false },
    { id: 'tari', label: 'TARI', every: 6, estimated: true },
  ] },
  assicurazioni: { label: 'Assicurazioni', presets: [
    { id: 'polizza-casa', label: 'Polizza casa', every: 12, estimated: false },
    { id: 'assicurazione-auto', label: 'Assicurazione auto', every: 12, estimated: false },
    { id: 'polizza-vita', label: 'Polizza vita', every: 12, estimated: false },
    { id: 'polizza-salute', label: 'Polizza salute', every: 12, estimated: false },
  ] },
  auto: { label: 'Auto', presets: [
    { id: 'bollo', label: 'Bollo auto', every: 12, estimated: false },
    { id: 'box', label: 'Box / parcheggio', every: 1, estimated: false },
  ] },
  abbonamenti: { label: 'Abbonamenti', presets: [
    { id: 'streaming', label: 'Streaming', every: 1, estimated: false },
    { id: 'palestra', label: 'Palestra', every: 1, estimated: false },
  ] },
  tasse: { label: 'Tasse', presets: [
    { id: 'imu', label: 'IMU', every: 6, estimated: true },
  ] },
  altro: { label: 'Altro', presets: [] },
};

// Categorie assegnate in automatico a prestiti e carta.
export const FIXED_CATEGORIES = { finanziamenti: 'Finanziamenti', carta: 'Carta di credito' };

export const OTHER_PRESET = { id: 'altro', label: 'Altra voce', every: 1, estimated: false };

// Le categorie vivono nei dati (data.categories) e si modificano in Impostazioni; queste sono solo le iniziali.
export const defaultCategories = () => Object.entries(CATEGORIES).map(([id, c]) => ({ id, label: c.label, presets: structuredClone(c.presets) }));

export const presetsOf = (cats, category) => [...(cats.find((c) => c.id === category)?.presets ?? []), OTHER_PRESET];

export const categoryLabel = (cats, id) => cats.find((c) => c.id === id)?.label ?? FIXED_CATEGORIES[id] ?? 'Altro';

// "Luce, 2, stimato" per riga: nome, ogni quanti mesi, "stimato" facoltativo.
export const presetsToText = (presets) => presets.map((p) => `${p.label}, ${p.every}${p.estimated ? ', stimato' : ''}`).join('\n');

export function textToPresets(text, existing = []) {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((line, n) => {
    const [label, every, flag] = line.split(',').map((s) => s.trim());
    const old = existing.find((p) => p.label === label);
    return { id: old?.id ?? `p${Date.now().toString(36)}${n}`, label, every: Math.max(1, parseInt(every, 10) || 1), estimated: /^stim/i.test(flag ?? '') };
  });
}
