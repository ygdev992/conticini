import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

export const cloudEnabled = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

let client = null;
let session = null;
let rowId = null;
let remoteStamp = null;
let timer = null;
let status = cloudEnabled ? 'offline' : 'locale';
const listeners = new Set();

export const onStatus = (fn) => listeners.add(fn);
export const getStatus = () => status;
export const getEmail = () => session?.user?.email ?? null;
export const signedIn = () => !!session;

function setStatus(s) {
  status = s;
  listeners.forEach((fn) => fn(s));
}

async function getClient() {
  if (!client) {
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return client;
}

export async function init() {
  if (!cloudEnabled) return;
  const sb = await getClient();
  session = (await sb.auth.getSession()).data.session;
  sb.auth.onAuthStateChange((_e, s) => { session = s; });
}

export async function signIn(email, password) {
  const sb = await getClient();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  session = data.session;
}

export async function signUp(email, password) {
  const sb = await getClient();
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) throw error;
  session = data.session;
  return !!data.session;
}

export async function signOut() {
  const sb = await getClient();
  await sb.auth.signOut();
  session = null;
  rowId = null;
  remoteStamp = null;
}

// Scarica i dati dal cloud. Ritorna null se la coppia non ha ancora una riga.
export async function pull() {
  setStatus('sync');
  try {
    const sb = await getClient();
    const { data, error } = await sb.from('household').select('id,data,updated_at,allowed_emails').limit(1).maybeSingle();
    if (error) throw error;
    setStatus('ok');
    if (!data) return null;
    rowId = data.id;
    remoteStamp = data.updated_at;
    return { data: data.data, updatedAt: data.updated_at, allowedEmails: data.allowed_emails };
  } catch (err) {
    setStatus('offline');
    throw err;
  }
}

// Controlla se qualcun altro ha salvato dopo di noi (vince l'ultimo salvataggio).
export async function remoteChanged() {
  if (!rowId) return false;
  const sb = await getClient();
  const { data } = await sb.from('household').select('updated_at').eq('id', rowId).maybeSingle();
  return !!data && data.updated_at !== remoteStamp;
}

export async function push(appData, allowedEmails) {
  setStatus('sync');
  try {
    const sb = await getClient();
    const stamp = new Date().toISOString();
    if (!rowId) {
      const { data, error } = await sb.from('household')
        .insert({ allowed_emails: allowedEmails ?? [getEmail()], data: appData, updated_at: stamp }).select('id').single();
      if (error) throw error;
      rowId = data.id;
    } else {
      const patch = { data: appData, updated_at: stamp };
      if (allowedEmails) patch.allowed_emails = allowedEmails;
      const { error } = await sb.from('household').update(patch).eq('id', rowId);
      if (error) throw error;
    }
    remoteStamp = stamp;
    setStatus('ok');
  } catch (err) {
    setStatus('offline');
    throw err;
  }
}

// Salvataggio ritardato: raggruppa le modifiche ravvicinate in un solo invio.
export function schedulePush(getData) {
  if (!cloudEnabled || !session || !rowId) return;
  clearTimeout(timer);
  setStatus('sync');
  timer = setTimeout(() => { timer = null; push(getData()).catch(() => {}); }, 800);
}

export const hasPending = () => timer !== null;
