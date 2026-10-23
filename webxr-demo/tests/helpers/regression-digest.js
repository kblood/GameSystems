// Digests of the grasp closure and of the VRIK solve over fixed inputs, used by the "default is bit-identical" tests
// (ladder-mugbody.test.js, elbow-hint.test.js). The golden values were produced by running these very functions on the code
// BEFORE the axis / elbow-hint additions (git HEAD of the branch at that time); any difference in a default result changes them.
import { createHash } from 'node:crypto';

const round = v => typeof v === 'number' ? Math.round(v * 1e9) / 1e9 + 0 : Array.isArray(v) ? v.map(round)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)])) : v;

/** Closure + scoreGrasp of every BAKED pose (kinds with a catalogue shape) on the reference hands at scale 1, qualities low / mid. */
export function closureDigest(g) {
  const h = createHash('sha256'); let n = 0;
  g.setProceduralGrasps(false);
  const was = g.graspQuality();
  try {
    const hands = Object.fromEntries(['left', 'right'].map(side => [side, g.referenceHand(side)]));
    for (const q of ['low', 'mid']) {
      g.setGraspQuality(q);
      for (const p of g.BAKED.poses) {
        if (!g.CATALOG[p.kind]) continue;
        const c = g.closeToContact(p, hands[p.side], g.CATALOG[p.kind].shape, { search: q === 'mid' ? 'mid' : null });
        h.update(JSON.stringify(round({ w: c.wrist, q: c.quat, a: c.angles, o: c.open, f: c.fingers, gr: c.grade })));
        const s = g.scoreGrasp(p, hands[p.side]);
        h.update(JSON.stringify(round({ ok: s.ok, f: s.failures, m: s.metrics }))); n++;
      }
    }
  } finally { g.setGraspQuality(was); }
  return { n, hash: h.digest('hex') };
}

/** 600 frames of the VRIK solve (head, two moving hands, one hand dropping out) on a rig: pose, root, positions, placement. */
export function vrikDigest(createVRIK, rig) {
  const h = createHash('sha256'), v = createVRIK(rig, { clips: false });
  for (let i = 0; i < 600; i++) {
    const t = i / 72, qy = Math.sin(t * 0.3) * 0.3;
    const r = v.solve({ head: { pos: [0.1 * Math.sin(t), 1.6 + 0.05 * Math.sin(2 * t), 0.05 * t], quat: [0, qy, 0, Math.sqrt(1 - qy * qy)] },
      hands: { left: { pos: [-0.3, 1.2 + 0.3 * Math.sin(t), -0.4 + 0.2 * Math.cos(t)], quat: [0, 0, 0, 1], valid: true },
        right: { pos: [0.3, 1.1 + 0.4 * Math.cos(1.3 * t), -0.3], quat: [0.1, 0, 0, Math.sqrt(0.99)], valid: i % 200 < 150 } }, fingers: { left: null, right: null }, scale: 1 }, 1 / 72);
    h.update(JSON.stringify([r.pose.joints, r.pose.root, r.positions, r.rig]));
  }
  return h.digest('hex');
}
