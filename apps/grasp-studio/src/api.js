// Client of the dev-server save endpoint (server/grasp_store.mjs, mounted at ./api/grasps by vite.config.js).
// A static build has no endpoint: save() then reports offline and the page offers the poses as a JSON download.
// Hand clips (animation / gesture modes) go to ./api/hand (server/hand_store.mjs) the same way.
const URL_ = (path = 'api/grasps') => new URL(path, document.baseURI).href;

async function call(body, path) {
  const res = await fetch(URL_(path), body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const type = res.headers.get('content-type') || '';
  if (!type.includes('application/json')) return { ok: false, offline: true, error: `no save endpoint (HTTP ${res.status}); run npm run dev` };
  const data = await res.json();
  return res.ok ? (body ? data : { ok: true, library: data }) : { ok: false, error: data.error || `HTTP ${res.status}` };
}
const guard = p => p.catch(error => ({ ok: false, offline: true, error: error.message }));

export const library = () => guard(call(null));
export const save = poses => guard(call({ action: 'save', poses }));
export const markDefault = ids => guard(call({ action: 'default', ids }));
export const remove = ids => guard(call({ action: 'delete', ids }));
export const handLibrary = () => guard(call(null, 'api/hand'));
export const saveHand = clips => guard(call({ action: 'save', clips }, 'api/hand'));
export const removeHand = ids => guard(call({ action: 'delete', ids }, 'api/hand'));

/** Offline fallback: the poses as a recorded-library JSON file download. */
export function download(poses, schema, { key = 'poses', name = 'recorded_grasps.part.json' } = {}) {
  const blob = new Blob([JSON.stringify({ schema, [key]: poses }, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
