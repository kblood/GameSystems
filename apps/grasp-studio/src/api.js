// Client of the dev-server save endpoint (server/grasp_store.mjs, mounted at ./api/grasps by vite.config.js).
// A static build has no endpoint: save() then reports offline and the page offers the poses as a JSON download.
// Hand clips (animation / gesture modes) go to ./api/hand (server/hand_store.mjs) the same way.
//
// Nothing recorded is lost when a save fails: main.js puts every save in the PENDING queue (localStorage) before it
// sends it and takes it out only when the endpoint confirmed it; the queue is retried on page load and from the panel
// ("Gem kø"). localStorage can be missing or full (private window, quota): every access is wrapped, and the queue then
// lives in memory for the session.
const URL_ = (path = 'api/grasps') => new URL(path, document.baseURI).href;

async function call(body, path) {
  const res = await fetch(URL_(path), body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' } : { cache: 'no-store' });
  const type = res.headers.get('content-type') || '';
  if (!type.includes('application/json')) return { ok: false, offline: true, status: res.status, error: `no save endpoint (HTTP ${res.status}); run npm run dev` };
  const data = await res.json();
  return res.ok ? (body ? data : { ok: true, library: data }) : { ok: false, status: res.status, error: data.error || `HTTP ${res.status}`, kept: data.kept };
}
const guard = p => p.catch(error => ({ ok: false, offline: true, error: error.message }));

export const library = () => guard(call(null));
export const save = poses => guard(call({ action: 'save', poses }));
export const markDefault = ids => guard(call({ action: 'default', ids }));
export const remove = ids => guard(call({ action: 'delete', ids }));
export const handLibrary = () => guard(call(null, 'api/hand'));
export const saveHand = clips => guard(call({ action: 'save', clips }, 'api/hand'));
export const removeHand = ids => guard(call({ action: 'delete', ids }, 'api/hand'));

// ---- pending queue ----------------------------------------------------------------------------------------------------
export const PENDING_KEY = 'grasp-studio.pending.v1';
let memory = null;   // the queue as last read / written (the panel asks every frame; localStorage is read once)
function readQueue() {
  if (memory) return memory;
  try { const v = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); memory = Array.isArray(v) ? v : []; } catch { memory = []; }
  return memory;
}
function writeQueue(list) {
  memory = list;
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(list)); return true; } catch { return false; }
}
/** The unsaved saves: [{ key, kind: 'grasps' | 'hand', items, at, error, tries }], oldest first. */
export const pending = () => readQueue();
/** Queue a save before sending it; returns its key (and whether it reached localStorage). */
export function keepPending(kind, items) {
  const key = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const stored = writeQueue([...readQueue(), { key, kind, items, at: new Date().toISOString(), error: null, tries: 0 }]);
  return { key, stored };
}
export function markPending(key, error) {
  writeQueue(readQueue().map(e => (e.key === key ? { ...e, error, tries: (e.tries || 0) + 1 } : e)));
}
export const dropPending = key => writeQueue(readQueue().filter(e => e.key !== key));

/** Send one queued save; on success it leaves the queue. -> the endpoint's answer. */
export async function sendPending(entry) {
  const res = await (entry.kind === 'hand' ? saveHand(entry.items) : save(entry.items));
  if (res.ok) dropPending(entry.key); else markPending(entry.key, res.error);
  return res;
}
/** Retry every queued save (oldest first) -> { saved: [results], failed: [{ entry, error }] }. */
export async function retryPending() {
  const saved = [], failed = [];
  for (const entry of readQueue()) {
    const res = await sendPending(entry);
    if (res.ok) saved.push({ entry, res }); else failed.push({ entry, error: res.error });
  }
  return { saved, failed };
}

/** Offline fallback: the poses as a recorded-library JSON file download. */
export function download(poses, schema, { key = 'poses', name = 'recorded_grasps.part.json' } = {}) {
  const blob = new Blob([JSON.stringify({ schema, [key]: poses }, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
