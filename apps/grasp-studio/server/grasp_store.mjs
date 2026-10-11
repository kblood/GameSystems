// Grasp Studio's save endpoint (dev server only; vite.config.js mounts it at /api/grasps). It writes the recorded grasp
// library straight into the project: GameSystems/extensions/grasp/recorded_grasps.json (or GRASP_STUDIO_OUT). Recordings
// are VARIANTS: baked_grasps.js keeps the bake as the library until a game picks recordings (setGraspVariants /
// ?graspvariant=...); games pick the file up with their sync (demo `npm run sync`, Contracts `npm run sync:extensions`).
//
//   GET  /api/grasps                         -> the library { schema, note, poses }
//   POST /api/grasps { action: 'save', poses: [pose, ...] }   APPEND: never replaces an earlier recording (an id that is
//                                                             taken gets a -2, -3 ... suffix); a pose marked default
//                                                             ("preferred") clears that flag on the other recorded poses
//                                                             of its kind/side/grasp
//   POST /api/grasps { action: 'default', ids: [...] }        mark saved poses preferred (same rule)
//   POST /api/grasps { action: 'delete', ids: [...] }         remove saved poses (the only way anything is removed)
// Every POST answers { ok, library, changed: [ids] }, or { ok: false, error, kept? } with status 400/403/413.
// Poses must pass the extension's isPose() check, loaded FRESH whenever record.js changes on disk (freshExport): a
// long-running dev server (the headset lab) once kept the validator it started with and refused every recording made
// after the 5-value thumb rows landed. A save that is refused anyway is not lost: its body is appended to a
// .rejected.jsonl file (rejectFile) and the refusal is logged. Writes are serialised and atomic (temp file + rename).
// Only same-machine pages may write: a cross-site Origin is refused and the body must be application/json (so a foreign
// page cannot post without a CORS preflight the dev server never grants).
import { readFile, writeFile, rename, mkdir, stat, appendFile } from 'node:fs/promises';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RECORDED_SCHEMA, isPose as staticIsPose } from '../../../extensions/grasp/record.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_FILE = resolve(HERE, '../../../extensions/grasp/recorded_grasps.json');
/** Refused saves of the project libraries (kept out of extensions/, which the games sync wholesale). */
export const DEFAULT_REJECT_DIR = resolve(HERE, '../rejected');
const NOTE = 'Grasps recorded with GameSystems/apps/grasp-studio (written by its dev-server endpoint). Variants: baked_grasps.js keeps the bake unless a game picks recordings (setGraspVariants, ?graspvariant=recorded|<id>); see record.js.';

/**
 * An export of a module that is re-imported whenever its file changes on disk (mtime), so a long-running dev server
 * validates with the current code. Falls back to `fallback` (the statically imported one) when the fresh import fails,
 * e.g. when the new file needs a sibling export the process has cached in its old version (restart the server then).
 */
export function freshExport(url, name, fallback, { log = () => {} } = {}) {
  const file = fileURLToPath(url);
  let mtime = null, current = fallback, warned = null;
  return async () => {
    const m = (await stat(file).catch(() => null))?.mtimeMs ?? null;
    if (m != null && m !== mtime) {
      try {
        const mod = await import(`${url.href}?v=${Math.round(m)}`);
        if (typeof mod[name] === 'function') { current = mod[name]; if (mtime != null) log(`reloaded ${name} from ${file}`); }
        mtime = m;
      } catch (error) {
        if (warned !== m) log(`could not reload ${name} from ${file} (${error.message}); using the version loaded at start: restart the dev server / lab`);
        warned = m;
      }
    }
    return current;
  };
}

/** Default .rejected.jsonl for a library file: rejected/<name>.rejected.jsonl for the project file, else beside the file. */
export function rejectFileFor(file, defaultFile, rejectDir = DEFAULT_REJECT_DIR) {
  return resolve(file) === resolve(defaultFile) ? resolve(rejectDir, `${basename(file, '.json')}.rejected.jsonl`) : `${file}.rejected.jsonl`;
}
/** Keep a refused save: one JSON line { at, error, ua, body } (body as parsed, or the raw text when it was no JSON). */
export async function keepRejected(rejectFile, { error, body, ua = '' }) {
  try {
    await mkdir(dirname(rejectFile), { recursive: true });
    await appendFile(rejectFile, JSON.stringify({ at: new Date().toISOString(), error, ua: String(ua).slice(0, 300), body }) + '\n');
    return rejectFile;
  } catch { return null; }
}
const MAX_BODY = 512 * 1024;

export const emptyLibrary = () => ({ schema: RECORDED_SCHEMA, note: NOTE, poses: [] });

/** The library at `file` (an empty one when the file does not exist yet). */
export async function readLibrary(file = DEFAULT_FILE) {
  const text = await readFile(file, 'utf8').catch(e => { if (e.code === 'ENOENT') return null; throw e; });
  if (text == null) return emptyLibrary();
  const doc = JSON.parse(text);
  if (doc.schema !== RECORDED_SCHEMA || !Array.isArray(doc.poses)) throw new Error(`${file}: not a ${RECORDED_SCHEMA} library`);
  return doc;
}

/** One pose per line, so recordings diff cleanly in git. */
export function serializeLibrary(doc) {
  const head = `{\n  "schema": ${JSON.stringify(doc.schema ?? RECORDED_SCHEMA)},\n  "note": ${JSON.stringify(doc.note ?? NOTE)},\n  "poses": [`;
  return `${head}${doc.poses.length ? '\n' + doc.poses.map(p => `    ${JSON.stringify(p)}`).join(',\n') + '\n  ' : ''}]\n}\n`;
}

export async function writeLibrary(file, doc) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, serializeLibrary(doc));
  await rename(tmp, file);
}

const key = p => `${p.kind}/${p.side}/${p.grasp}`;
export class ActionError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }

/** `id`, or `id-2`, `id-3` ... : the first that is not in `taken` (a Set; the result is added to it). */
export function uniqueId(id, taken) {
  let out = id;
  for (let k = 2; taken.has(out); k++) out = `${id}-${k}`;
  taken.add(out);
  return out;
}

/** Apply an action to a library document (pure: returns { doc, changed }); throws ActionError on bad input. */
export function applyAction(doc, action, { isPose = staticIsPose } = {}) {
  const poses = doc.poses.map(p => ({ ...p })), changed = [];
  const clearDefaults = keep => {
    for (const p of poses) if (p.default && key(p) === key(keep) && p.id !== keep.id) { p.default = false; changed.push(p.id); }
  };
  if (action?.action === 'save') {
    const list = action.poses;
    if (!Array.isArray(list) || !list.length) throw new ActionError('save: poses must be a non-empty array');
    for (const p of list) if (!isPose(p)) throw new ActionError(`save: invalid pose ${p?.id ?? '?'}`);
    const taken = new Set(poses.map(p => p.id)), added = [];
    for (const p of list) {
      // Append only: an id that is taken (a re-sent save, a second recording in the same second) gets a suffix.
      const copy = { ...p, id: uniqueId(p.id, taken), default: !!p.default };
      poses.push(copy); added.push(copy);
      changed.push(copy.id);
    }
    for (const p of added) if (p.default) clearDefaults(p);
  } else if (action?.action === 'default' || action?.action === 'delete') {
    const ids = action.ids;
    if (!Array.isArray(ids) || !ids.length) throw new ActionError(`${action.action}: ids must be a non-empty array`);
    for (const id of ids) if (!poses.some(p => p.id === id)) throw new ActionError(`${action.action}: no recorded pose ${id}`);
    if (action.action === 'delete') {
      changed.push(...ids);
      return { doc: { ...doc, poses: poses.filter(p => !ids.includes(p.id)) }, changed };
    }
    for (const id of ids) {
      const p = poses.find(q => q.id === id);
      p.default = true; changed.push(id);
      clearDefaults(p);
    }
  } else throw new ActionError(`unknown action ${action?.action}`);
  return { doc: { ...doc, poses }, changed: [...new Set(changed)] };
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
/** True for requests from this machine's pages (no Origin header, or an Origin on a local host). */
export function sameMachine(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return LOCAL_HOSTS.has(new URL(origin).hostname); } catch { return false; }
}

export function readBody(req) {
  return new Promise((ok, fail) => {
    let size = 0; const parts = [];
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { fail(new ActionError('body too large', 413)); req.destroy(); } else parts.push(c); });
    req.on('end', () => ok(Buffer.concat(parts).toString('utf8')));
    req.on('error', fail);
  });
}

/**
 * Connect-style JSON store middleware shared by /api/grasps and /api/hand: GET -> read(file); POST -> serialised
 * read-modify-write through apply(doc, action, validators) -> write(file, doc). Every POST outcome is logged; a refused
 * save is kept in rejectFile (keepRejected) and the answer says so ({ kept }).
 */
export function jsonStore({ file, rejectFile, read, write, apply, validators = async () => ({}), log = () => {}, label = '' }) {
  let queue = Promise.resolve();
  const send = (res, status, body) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)); };
  const middleware = async (req, res, next) => {
    const path = (req.url || '').split('?')[0];
    if (path !== '/' && path !== '') return next();
    let text = null, action = null;
    try {
      if (req.method === 'GET') return send(res, 200, await read(file));
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'GET or POST' });
      if (!sameMachine(req)) { log(`${label}refused cross-site POST from ${req.headers.origin}`); return send(res, 403, { ok: false, error: 'cross-site request refused' }); }
      if (!/^application\/json\b/.test(req.headers['content-type'] || '')) return send(res, 400, { ok: false, error: 'Content-Type must be application/json' });
      text = await readBody(req);
      action = JSON.parse(text);
      const checks = await validators();
      // Serialise read-modify-write so two quick saves never lose one.
      const result = queue.then(async () => {
        const { doc, changed } = apply(await read(file), action, checks);
        await write(file, doc);
        return { doc, changed };
      });
      queue = result.catch(() => {});
      const { doc, changed } = await result;
      log(`${label}${action.action}: ${changed.join(', ')} -> ${file}`);
      return send(res, 200, { ok: true, library: doc, changed });
    } catch (error) {
      const status = error.status || (error instanceof SyntaxError ? 400 : 500);
      let kept = null;
      if (action?.action === 'save' || (text && !action)) kept = await keepRejected(rejectFile, { error: error.message, body: action ?? text, ua: req.headers['user-agent'] });
      log(`${label}${action?.action ?? req.method} REFUSED (${status}): ${error.message}${kept ? ` - body kept in ${kept}` : ''}`);
      return send(res, status, { ok: false, error: error.message, ...(kept ? { kept: basename(kept) } : {}) });
    }
  };
  middleware.file = file;
  middleware.rejectFile = rejectFile;
  return middleware;
}

/** Connect-style middleware for the library at `file` (mount at /api/grasps). */
export function graspStore({ file = DEFAULT_FILE, rejectFile = rejectFileFor(file, DEFAULT_FILE), log = () => {} } = {}) {
  const isPose = freshExport(new URL('../../../extensions/grasp/record.js', import.meta.url), 'isPose', staticIsPose, { log });
  return jsonStore({ file, rejectFile, read: readLibrary, write: writeLibrary, apply: applyAction, log,
    validators: async () => ({ isPose: await isPose() }) });
}
