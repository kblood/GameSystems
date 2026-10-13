// A grasp recorded in Grasp Studio (GameSystems/apps/grasp-studio) and saved through its dev-server endpoint is loaded
// as a selectable variant by the demo's grasp extension after `npm run sync`: a temp copy of src/vendor/extensions/grasp stands in for the
// synced copy, and the studio's endpoint writes its recorded_grasps.json (as it writes the source file in a session).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { listFiles } from '../../scripts/sync_lib.mjs';

const vendored = fileURLToPath(new URL('../src/vendor/extensions/grasp/', import.meta.url));
const studioDir = fileURLToPath(new URL('../../apps/grasp-studio/', import.meta.url));
const skip = !existsSync(join(studioDir, 'src/vendor/extensions/grasp/index.js')) && 'Grasp Studio not synced (npm run sync in apps/grasp-studio)';

test('a studio recording saved through the endpoint preserves bakes and closes on the bottle when selected', { skip }, async () => {
  const { graspStore } = await import(pathToFileURL(join(studioDir, 'server/grasp_store.mjs')).href);
  const { createStudio, syntheticHands } = await import(pathToFileURL(join(studioDir, 'src/studio.js')).href);
  const dir = await mkdtemp(join(tmpdir(), 'demo-recorded-grasp-'));
  const store = graspStore({ file: join(dir, 'recorded_grasps.json') });
  const server = createServer((req, res) => { req.url = req.url.replace(/^\/api\/grasps/, '') || '/'; store(req, res, () => { res.statusCode = 404; res.end(); }); });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  try {
    // This endpoint test owns a fresh recording store, independent of artists' existing recordings.
    for (const source of await listFiles(vendored)) {
      const f = relative(vendored, source);
      if (f === 'recorded_grasps.json') continue;
      const target = join(dir, f);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(source, target);
    }
    // "Record": the studio model with a synthetic tracked hand (25 XR joints) holding the beer bottle.
    const studio = createStudio();
    studio.setItem([0.1, 0.9, -0.4], [0, 0, 0, 1]);
    for (let i = 0; i < 72 * 3 && !studio.review; i++) studio.update(i / 72, syntheticHands(i / 72, studio.item, { approach: 0 }));
    assert.ok(studio.review?.score.ok, 'synthetic recording scored ok');
    const poses = studio.accept({ markDefault: true });
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/grasps`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', poses }) });
    assert.equal(res.status, 200);

    const grasp = await import(pathToFileURL(join(dir, 'index.js')).href);
    const baked = await import('../src/vendor/extensions/grasp/index.js');
    assert.equal(grasp.RECORDED.length, 2);
    for(const side of ['left','right'])assert.equal(grasp.defaultPose('bottle_beer',side,'body').id,baked.defaultPose('bottle_beer',side,'body').id,'saving a recording keeps the baked default');
    assert.equal(grasp.setGraspVariants('recorded').ids.length,2,'recorded variants are enabled explicitly');
    for (const side of ['left', 'right']) {
      const pose = grasp.defaultPose('bottle_beer', side, 'body');
      assert.ok(pose.recorded && pose.id === poses.find(p => p.side === side).id, `${side}: the recording is the default`);
      assert.equal(grasp.posesFor('bottle_beer', side).filter(p => p.grasp === 'body' && p.default).length, 1, 'still exactly one default');
      assert.equal(grasp.posesFor('bottle_beer', side).length, baked.posesFor('bottle_beer', side).length + 1);
      const hand = grasp.referenceHand(side), shape = grasp.CATALOG.bottle_beer.shape;
      const shown = grasp.graspPose(pose, hand, { shape });
      assert.ok(shown.angles.length === 5 && shown.wrist.every(Number.isFinite), 'closed to contact on the reference hand');
      assert.ok(grasp.scoreGrasp(pose).ok, `${side} recording validates`);
    }
    assert.equal(grasp.defaultPose('can', 'right', 'body'), grasp.poseById(baked.defaultPose('can', 'right', 'body').id), 'other kinds keep their bakes');
  } finally {
    await new Promise(ok => server.close(ok));
    await rm(dir, { recursive: true });
  }
});
