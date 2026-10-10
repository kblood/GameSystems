// Grasp Studio's hand-animation endpoint (dev server only; vite.config.js mounts it at /api/hand), the twin of
// grasp_store.mjs for the animation and gesture modes (extensions plan step 7). It writes recorded hand clips (the avatar
// extension's one frame format, handposes.js) straight into GameSystems/extensions/avatar/recorded_hand.json (or
// GRASP_STUDIO_HAND_OUT), which handposes.js buildLibrary merges over hand_poses.json (same id = replaced); games pick it
// up with their sync.
//
//   GET  /api/hand                                   -> { schema, note, clips }
//   POST /api/hand { action: 'save', clips: [...] }  add (or replace by id + side)
//   POST /api/hand { action: 'delete', ids: [...] }  remove clips by id (both sides)
// Same rules as grasp_store: application/json only, same-machine origins only, serialised atomic writes, 512 kB cap.
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isClip, HAND_RECORDINGS_SCHEMA } from '../../../extensions/avatar/handposes.js';
import { sameMachine, readBody, ActionError } from './grasp_store.mjs';

export const DEFAULT_HAND_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../extensions/avatar/recorded_hand.json');
const NOTE = 'Hand poses and hand animations recorded with GameSystems/apps/grasp-studio (written by its dev-server endpoint /api/hand). Same clip format as hand_poses.json; a recorded clip replaces the library clip with the same id (handposes.js buildLibrary).';

export const emptyHandLibrary = () => ({ schema: HAND_RECORDINGS_SCHEMA, note: NOTE, clips: [] });

export async function readHandLibrary(file = DEFAULT_HAND_FILE) {
  const text = await readFile(file, 'utf8').catch(e => { if (e.code === 'ENOENT') return null; throw e; });
  if (text == null) return emptyHandLibrary();
  const doc = JSON.parse(text);
  if (doc.schema !== HAND_RECORDINGS_SCHEMA || !Array.isArray(doc.clips)) throw new Error(`${file}: not a ${HAND_RECORDINGS_SCHEMA} library`);
  return doc;
}

/** One clip per line, so recordings diff cleanly in git. */
export function serializeHandLibrary(doc) {
  const head = `{\n  "schema": ${JSON.stringify(doc.schema ?? HAND_RECORDINGS_SCHEMA)},\n  "note": ${JSON.stringify(doc.note ?? NOTE)},\n  "clips": [`;
  return `${head}${doc.clips.length ? '\n' + doc.clips.map(c => `    ${JSON.stringify(c)}`).join(',\n') + '\n  ' : ''}]\n}\n`;
}

const key = c => `${c.id}/${c.side ?? ''}`;
/** Apply an action (pure: returns { doc, changed }); throws ActionError on bad input. */
export function applyHandAction(doc, action) {
  const clips = doc.clips.map(c => ({ ...c })), changed = [];
  if (action?.action === 'save') {
    const list = action.clips;
    if (!Array.isArray(list) || !list.length) throw new ActionError('save: clips must be a non-empty array');
    for (const c of list) if (!isClip(c)) throw new ActionError(`save: invalid clip ${c?.id ?? '?'}`);
    for (const c of list) {
      const at = clips.findIndex(q => key(q) === key(c));
      if (at >= 0) clips[at] = { ...c }; else clips.push({ ...c });
      changed.push(c.id);
    }
  } else if (action?.action === 'delete') {
    const ids = action.ids;
    if (!Array.isArray(ids) || !ids.length) throw new ActionError('delete: ids must be a non-empty array');
    for (const id of ids) if (!clips.some(c => c.id === id)) throw new ActionError(`delete: no recorded clip ${id}`);
    changed.push(...ids);
    return { doc: { ...doc, clips: clips.filter(c => !ids.includes(c.id)) }, changed };
  } else throw new ActionError(`unknown action ${action?.action}`);
  return { doc: { ...doc, clips }, changed: [...new Set(changed)] };
}

/** Connect-style middleware for the hand library at `file` (mount at /api/hand). */
export function handStore({ file = DEFAULT_HAND_FILE, log = () => {} } = {}) {
  let queue = Promise.resolve();
  const send = (res, status, body) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)); };
  const middleware = async (req, res, next) => {
    const path = (req.url || '').split('?')[0];
    if (path !== '/' && path !== '') return next();
    try {
      if (req.method === 'GET') return send(res, 200, await readHandLibrary(file));
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'GET or POST' });
      if (!sameMachine(req)) return send(res, 403, { ok: false, error: 'cross-site request refused' });
      if (!/^application\/json\b/.test(req.headers['content-type'] || '')) return send(res, 400, { ok: false, error: 'Content-Type must be application/json' });
      const action = JSON.parse(await readBody(req));
      const result = queue.then(async () => {
        const { doc, changed } = applyHandAction(await readHandLibrary(file), action);
        await mkdir(dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        await writeFile(tmp, serializeHandLibrary(doc));
        await rename(tmp, file);
        return { doc, changed };
      });
      queue = result.catch(() => {});
      const { doc, changed } = await result;
      log(`hand ${action.action}: ${changed.join(', ')} -> ${file}`);
      return send(res, 200, { ok: true, library: doc, changed });
    } catch (error) {
      return send(res, error.status || (error instanceof SyntaxError ? 400 : 500), { ok: false, error: error.message });
    }
  };
  middleware.file = file;
  return middleware;
}
