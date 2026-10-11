// The save endpoint (server/grasp_store.mjs) on a real HTTP server writing to a temp file, and the written library
// loaded by a copy of the grasp extension (as a game does after its sync).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, copyFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { graspStore, applyAction, readLibrary, serializeLibrary, emptyLibrary, sameMachine, uniqueId } from '../server/grasp_store.mjs';
import { createStudio, syntheticHands } from '../src/studio.js';

const extensionDir = fileURLToPath(new URL('../src/vendor/extensions/grasp/', import.meta.url));

/** Two recorded poses (right + mirrored left) from a synthetic capture. */
function recorded({ markDefault = false, side = 'right' } = {}) {
  const studio = createStudio({ side });
  studio.setItem([0, 1, -0.4], [0, 0, 0, 1]);
  for (let i = 0; i < 72 * 3 && !studio.review; i++) studio.update(i / 72, syntheticHands(i / 72, studio.item, { side }));
  return studio.accept({ markDefault });
}

async function serve(file) {
  const store = graspStore({ file });
  const server = createServer((req, res) => {
    if (!req.url.startsWith('/api/grasps')) { res.statusCode = 404; return res.end(); }
    req.url = req.url.slice('/api/grasps'.length) || '/';
    store(req, res, () => { res.statusCode = 404; res.end(); });
  });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${server.address().port}/api/grasps`;
  const post = (body, headers = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { url, post, close: () => new Promise(ok => server.close(ok)) };
}

test('applyAction: save only appends (a taken id gets a suffix), one default per kind/side/grasp, default/delete need saved ids', () => {
  const [a, am] = recorded({ markDefault: true });
  let { doc, changed } = applyAction(emptyLibrary(), { action: 'save', poses: [a, am] });
  assert.equal(doc.poses.length, 2); assert.deepEqual(changed, [a.id, am.id]);
  const b = { ...a, id: a.id + 'b', default: true };
  ({ doc, changed } = applyAction(doc, { action: 'save', poses: [b] }));
  assert.equal(doc.poses.find(p => p.id === a.id).default, false, 'the new default clears the old one');
  assert.equal(doc.poses.find(p => p.id === am.id).default, true, 'the other side keeps its default');
  ({ doc } = applyAction(doc, { action: 'default', ids: [a.id] }));
  assert.deepEqual(doc.poses.filter(p => p.side === 'right' && p.default).map(p => p.id), [a.id]);
  ({ doc, changed } = applyAction(doc, { action: 'save', poses: [{ ...a, wrist: [0, 0, 0], default: false }] }));
  assert.equal(doc.poses.length, 4, 'a re-sent id never replaces: it is kept as another variant');
  assert.deepEqual(changed, [`${a.id}-2`]);
  assert.notDeepEqual(doc.poses.find(p => p.id === a.id).wrist, [0, 0, 0], 'the earlier recording is untouched');
  assert.equal(doc.poses.find(p => p.id === a.id).default, true, 'a non-default save leaves the preferred pose alone');
  ({ doc } = applyAction(doc, { action: 'delete', ids: [b.id, `${a.id}-2`] }));
  assert.equal(doc.poses.length, 2, 'deleting stays explicit, by id');
  const taken = new Set(['x', 'x-2']);
  assert.equal(uniqueId('x', taken), 'x-3'); assert.equal(uniqueId('y', taken), 'y'); assert.ok(taken.has('x-3') && taken.has('y'));
  assert.throws(() => applyAction(doc, { action: 'save', poses: [{ ...a, quat: [1, 1, 1, 1] }] }), /invalid pose/);
  assert.throws(() => applyAction(doc, { action: 'save', poses: [] }), /non-empty/);
  assert.throws(() => applyAction(doc, { action: 'delete', ids: ['nope'] }), /no recorded pose/);
  assert.throws(() => applyAction(doc, { action: 'rename' }), /unknown action/);
});

test('library file: one pose per line, round-trips, missing file reads as empty', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'grasp-studio-'));
  try {
    assert.deepEqual((await readLibrary(join(dir, 'none.json'))).poses, []);
    const doc = { ...emptyLibrary(), poses: recorded() };
    const text = serializeLibrary(doc);
    assert.equal(text.split('\n').filter(l => l.startsWith('    {"id"')).length, 2);
    assert.deepEqual(JSON.parse(text), doc);
    assert.equal(serializeLibrary(emptyLibrary()).includes('"poses": []'), true);
    await writeFile(join(dir, 'bad.json'), '{"schema":"other","poses":[]}');
    await assert.rejects(readLibrary(join(dir, 'bad.json')), /not a gamesystems.recorded-grasps.v1/);
  } finally { await rm(dir, { recursive: true }); }
});

test('endpoint: GET, POST save to the file, refuses cross-site and non-JSON posts, serialises concurrent saves', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'grasp-studio-'));
  const file = join(dir, 'recorded_grasps.json'), srv = await serve(file);
  try {
    assert.deepEqual((await (await fetch(srv.url)).json()).poses, []);
    const poses = recorded();
    let res = await srv.post({ action: 'save', poses });
    let body = await res.json();
    assert.equal(res.status, 200, body.error); assert.equal(body.ok, true); assert.equal(body.library.poses.length, 2);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).poses, poses.map(p => ({ ...p, default: false })));
    res = await srv.post({ action: 'save', poses }, { Origin: 'https://evil.example' });
    assert.equal(res.status, 403);
    assert.ok(sameMachine({ headers: { origin: 'http://localhost:5180' } }) && sameMachine({ headers: {} }) && !sameMachine({ headers: { origin: 'http://192.168.1.9:5180' } }));
    res = await fetch(srv.url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'save', poses }) });
    assert.equal(res.status, 400);
    res = await srv.post('{not json');
    assert.equal(res.status, 400);
    res = await srv.post({ action: 'save', poses: [{ id: 'x' }] });
    body = await res.json();
    assert.equal(res.status, 400); assert.match(body.error, /invalid pose/);
    assert.equal(body.kept, 'recorded_grasps.json.rejected.jsonl', 'a refused save is kept, not dropped');
    const kept = (await readFile(`${file}.rejected.jsonl`, 'utf8')).trim().split(/\r?\n/).map(l => JSON.parse(l));
    const last = kept.at(-1);
    assert.match(last.error, /invalid pose/); assert.deepEqual(last.body.poses, [{ id: 'x' }]);
    res = await srv.post({ action: 'save', poses });
    assert.deepEqual((await res.json()).library.poses.slice(2).map(p => p.id), poses.map(p => `${p.id}-2`), 'the same save twice is two variants');
    await srv.post({ action: 'delete', ids: poses.map(p => `${p.id}-2`) });
    const more = [1, 2, 3].map(k => poses.map(p => ({ ...p, id: `${p.id}-${k}` })));
    const all = await Promise.all(more.map(list => srv.post({ action: 'save', poses: list })));
    assert.ok(all.every(r => r.status === 200));
    assert.equal(JSON.parse(await readFile(file, 'utf8')).poses.length, 8, 'no save lost');
    assert.ok(!(await readdir(dir)).some(f => f.endsWith('.tmp')), 'atomic write leaves no temp file');
  } finally { await srv.close(); await rm(dir, { recursive: true }); }
});

test('a grasp saved through the endpoint is in the grasp library a game loads (default, nearest pose, closed on a hand)', async () => {
  // A copy of the synced grasp extension stands in for a game's copy after `npm run sync`; the endpoint writes its
  // recorded_grasps.json like it writes GameSystems/extensions/grasp/recorded_grasps.json during a session.
  const dir = await mkdtemp(join(tmpdir(), 'grasp-studio-ext-'));
  const srv = await serve(join(dir, 'recorded_grasps.json'));
  try {
    for (const f of await readdir(extensionDir)) await copyFile(join(extensionDir, f), join(dir, f));
    // Start from an empty library: the synced copy holds whatever was really recorded in the studio.
    const synced = JSON.parse(await readFile(join(dir, 'recorded_grasps.json'), 'utf8'));
    await writeFile(join(dir, 'recorded_grasps.json'), JSON.stringify({ ...synced, poses: [] }));
    const poses = recorded({ markDefault: true });
    assert.equal((await srv.post({ action: 'save', poses })).status, 200);
    const lib = await import(pathToFileURL(join(dir, 'index.js')).href);
    assert.equal(lib.RECORDED.length, 2);
    // Recordings are options: the bake stays the default until a game picks them (?graspvariant=recorded or ids).
    for (const p of poses) assert.ok(!lib.defaultPose('bottle_beer', p.side, 'body').recorded, `${p.side} default stays baked`);
    assert.deepEqual(lib.graspVariants('bottle_beer', 'right', 'body').map(q => !!q.recorded), [false, true], 'the baked default, then the recording');
    let sel = lib.setGraspVariants([poses[0].id]);
    assert.deepEqual(sel.ids, [poses[0].id]);
    assert.equal(lib.defaultPose('bottle_beer', 'right', 'body').id, poses[0].id, 'an id selection makes that recording the default');
    assert.ok(!lib.defaultPose('bottle_beer', 'left', 'body').recorded, 'the other side keeps the bake');
    sel = lib.setGraspVariants('recorded');
    assert.equal(sel.selection, 'recorded');
    for (const p of poses) {
      const d = lib.defaultPose('bottle_beer', p.side, 'body');
      assert.equal(d.id, p.id, `${p.side} default is the recording`);
      assert.equal(lib.poseById(p.id).handLength, p.handLength);
      // The synthetic recording holds the baked default exactly, so filter to recordings to break the tie.
      const near = lib.nearestPose('bottle_beer', p.side, { pos: p.wrist, quat: p.quat }, { filter: q => !!q.recorded });
      assert.equal(near.pose.id, p.id, 'nearest pose at its own wrist');
      assert.ok(lib.nearestPose('bottle_beer', p.side, { pos: p.wrist, quat: p.quat }).distance < 1e-4, 'recordings take part in nearestPose');
      const shown = lib.graspPose(d, lib.referenceHand(p.side));
      assert.ok(lib.validateRows(Object.fromEntries(['Thumb', 'Index', 'Middle', 'Ring', 'Little'].map((f, i) => [f, shown.angles[i]]))).ok);
    }
    assert.equal(lib.BAKED.poses.filter(p => p.kind === 'bottle_beer' && p.grasp === 'body' && p.default).length, 2, 'the bake itself is unchanged');
    lib.setGraspVariants('baked');
    assert.ok(!lib.defaultPose('bottle_beer', 'right', 'body').recorded, 'back to the bake');
  } finally { await srv.close(); await rm(dir, { recursive: true }); }
});
