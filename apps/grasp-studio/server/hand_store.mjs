// Grasp Studio's hand-animation endpoint (dev server only; vite.config.js mounts it at /api/hand), the twin of
// grasp_store.mjs for the animation and gesture modes (extensions plan step 7). It writes recorded hand clips (the avatar
// extension's one frame format, handposes.js) straight into GameSystems/extensions/avatar/recorded_hand.json (or
// GRASP_STUDIO_HAND_OUT). Recordings are VARIANTS of their name: handposes.js buildLibrary keeps the library clip unless a
// game picks a recording (setHandVariants, ?handvariant=...); games pick the file up with their sync.
//
//   GET  /api/hand                                   -> { schema, note, clips }
//   POST /api/hand { action: 'save', clips: [...] }  APPEND: each clip is stored as a variant `<name>@rec-<stamp>` with
//                                                    variantOf = <name> (a bare name gets the stamp; a taken id + side
//                                                    gets a -2, -3 ... suffix; the clips of one save share their id)
//   POST /api/hand { action: 'delete', ids: [...] }  remove clips by id (both sides; the only way anything is removed)
// Same rules as grasp_store: application/json only, same-machine origins only, serialised atomic writes, 512 kB cap,
// isClip() reloaded when handposes.js changes, refused saves kept in a .rejected.jsonl file and logged.
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isClip as staticIsClip, HAND_RECORDINGS_SCHEMA } from '../../../extensions/avatar/handposes.js';
// The shared store code with this module's own query: vite.config.js imports both stores with ?t=<start> so a
// restarted dev server gets current code; a plain './grasp_store.mjs' would hand back the copy node cached at start.
const { ActionError, jsonStore, freshExport, rejectFileFor } = await import(`./grasp_store.mjs${new URL(import.meta.url).search}`);

export const DEFAULT_HAND_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../extensions/avatar/recorded_hand.json');
const NOTE = 'Hand poses and hand animations recorded with GameSystems/apps/grasp-studio (written by its dev-server endpoint /api/hand). Same clip format as hand_poses.json; each recording is a variant <name>@rec-<stamp> and never replaces the library clip unless a game picks it (handposes.js buildLibrary, setHandVariants, ?handvariant=).';

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
const stamp = at => String(at).replace(/[-:]/g, '').replace(/\.\d+Z?$|Z$/, '');
/** Apply an action (pure: returns { doc, changed }); throws ActionError on bad input. */
export function applyHandAction(doc, action, { isClip = staticIsClip, now = new Date().toISOString() } = {}) {
  const clips = doc.clips.map(c => ({ ...c })), changed = [];
  if (action?.action === 'save') {
    const list = action.clips;
    if (!Array.isArray(list) || !list.length) throw new ActionError('save: clips must be a non-empty array');
    for (const c of list) if (!isClip(c)) throw new ActionError(`save: invalid clip ${c?.id ?? '?'}`);
    // Append only. One save (a clip + its mirror) shares one new id per incoming id; it is unique over id + side.
    const taken = new Set(clips.map(key)), ids = new Map();
    for (const c of list) {
      const name = c.variantOf || String(c.id).split('@')[0];
      if (!ids.has(c.id)) {
        const base = String(c.id).includes('@') ? c.id : `${name}@rec-${stamp(c.recorded?.at ?? now)}`;
        let id = base;
        for (let k = 2; list.some(x => taken.has(`${id}/${x.side ?? ''}`)); k++) id = `${base}-${k}`;
        ids.set(c.id, id);
      }
      const copy = { ...c, id: ids.get(c.id), variantOf: name };
      taken.add(key(copy));
      clips.push(copy);
      changed.push(copy.id);
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

export async function writeHandLibrary(file, doc) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, serializeHandLibrary(doc));
  await rename(tmp, file);
}

/** Connect-style middleware for the hand library at `file` (mount at /api/hand). */
export function handStore({ file = DEFAULT_HAND_FILE, rejectFile = rejectFileFor(file, DEFAULT_HAND_FILE), log = () => {} } = {}) {
  const isClip = freshExport(new URL('../../../extensions/avatar/handposes.js', import.meta.url), 'isClip', staticIsClip, { log });
  return jsonStore({ file, rejectFile, read: readHandLibrary, write: writeHandLibrary, apply: applyHandAction, log, label: 'hand ',
    validators: async () => ({ isClip: await isClip() }) });
}
