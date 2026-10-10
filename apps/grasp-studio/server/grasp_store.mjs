// Grasp Studio's save endpoint (dev server only; vite.config.js mounts it at /api/grasps). It writes the recorded grasp
// library straight into the project: GameSystems/extensions/grasp/recorded_grasps.json (or GRASP_STUDIO_OUT), which the
// grasp extension's baked_grasps.js merges into its library; games pick it up with their sync (demo `npm run sync`,
// Contracts `npm run sync:extensions`).
//
//   GET  /api/grasps                         -> the library { schema, note, poses }
//   POST /api/grasps { action: 'save', poses: [pose, ...] }   add (or replace by id); a pose marked default clears
//                                                             the default of the other recorded poses of its kind/side/grasp
//   POST /api/grasps { action: 'default', ids: [...] }        mark saved poses default (same rule)
//   POST /api/grasps { action: 'delete', ids: [...] }         remove saved poses
// Every POST answers { ok, library, changed: [ids] }, or { ok: false, error } with status 400/403/413.
// Poses must pass the extension's isPose() check. Writes are serialised and atomic (temp file + rename). Only
// same-machine pages may write: a cross-site Origin is refused and the body must be application/json (so a foreign page
// cannot post without a CORS preflight the dev server never grants).
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RECORDED_SCHEMA, isPose } from '../../../extensions/grasp/record.js';

export const DEFAULT_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../extensions/grasp/recorded_grasps.json');
const NOTE = 'Grasps recorded with GameSystems/apps/grasp-studio (written by its dev-server endpoint). Merged into the baked library by baked_grasps.js; see record.js.';
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

/** Apply an action to a library document (pure: returns { doc, changed }); throws ActionError on bad input. */
export function applyAction(doc, action) {
  const poses = doc.poses.map(p => ({ ...p })), changed = [];
  const clearDefaults = keep => {
    for (const p of poses) if (p.default && key(p) === key(keep) && p.id !== keep.id) { p.default = false; changed.push(p.id); }
  };
  if (action?.action === 'save') {
    const list = action.poses;
    if (!Array.isArray(list) || !list.length) throw new ActionError('save: poses must be a non-empty array');
    for (const p of list) if (!isPose(p)) throw new ActionError(`save: invalid pose ${p?.id ?? '?'}`);
    for (const p of list) {
      const at = poses.findIndex(q => q.id === p.id), copy = { ...p, default: !!p.default };
      if (at >= 0) poses[at] = copy; else poses.push(copy);
      changed.push(p.id);
    }
    for (const p of list) if (p.default) clearDefaults(p);
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

/** Connect-style middleware for the library at `file` (mount at /api/grasps). */
export function graspStore({ file = DEFAULT_FILE, log = () => {} } = {}) {
  let queue = Promise.resolve();
  const send = (res, status, body) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)); };
  const middleware = async (req, res, next) => {
    const path = (req.url || '').split('?')[0];
    if (path !== '/' && path !== '') return next();
    try {
      if (req.method === 'GET') return send(res, 200, await readLibrary(file));
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'GET or POST' });
      if (!sameMachine(req)) return send(res, 403, { ok: false, error: 'cross-site request refused' });
      if (!/^application\/json\b/.test(req.headers['content-type'] || '')) return send(res, 400, { ok: false, error: 'Content-Type must be application/json' });
      const action = JSON.parse(await readBody(req));
      // Serialise read-modify-write so two quick saves never lose one.
      const result = queue.then(async () => {
        const { doc, changed } = applyAction(await readLibrary(file), action);
        await writeLibrary(file, doc);
        return { doc, changed };
      });
      queue = result.catch(() => {});
      const { doc, changed } = await result;
      log(`${action.action}: ${changed.join(', ')} -> ${file}`);
      return send(res, 200, { ok: true, library: doc, changed });
    } catch (error) {
      return send(res, error.status || (error instanceof SyntaxError ? 400 : 500), { ok: false, error: error.message });
    }
  };
  middleware.file = file;
  return middleware;
}
