// An engine-free physics adapter for tests: the full host interface (extensions/host/physics.js) on plain records, with
// no integration. Tests move bodies by hand (body.position = [...]), inject contact reports with contact(), and run
// step() to deliver them and the onStep listeners, the way a real adapter does after its physics step.
import { vec, quat } from '../src/vendor/extensions/host/index.js';

export function createFakePhysics() {
  const bodies = new Set(), contactListeners = new Set(), stepListeners = new Set(), queued = [];
  const fake = {
    bodies, log: [],
    get listeners() { return contactListeners.size + stepListeners.size; },

    addBody(shape, mass = 0, pose = {}, options = {}) {
      const body = { shape, mass, options, userData: options.userData ?? {}, held: false, removed: false,
        position: vec(pose.position), quaternion: quat(pose.quaternion), linear: vec(options.velocity), angular: vec(options.spin) };
      bodies.add(body); fake.log.push(['addBody', body]);
      return body;
    },
    pose(body, out = { position: [0, 0, 0], quaternion: [0, 0, 0, 1] }) {
      out.position.splice(0, 3, ...body.position); out.quaternion.splice(0, 4, ...body.quaternion);
      return out;
    },
    velocity(body, out = { linear: [0, 0, 0], angular: [0, 0, 0] }) {
      out.linear.splice(0, 3, ...body.linear); out.angular.splice(0, 3, ...body.angular);
      return out;
    },
    setMass(body, mass) { if (!body.removed) body.mass = mass; },
    hold(body, target) {
      if (body.removed) return;
      body.held = true; body.linear = [0, 0, 0]; body.angular = [0, 0, 0];
      body.position = vec(target.position); body.quaternion = quat(target.quaternion);
    },
    release(body, velocity, spin) { if (!body.removed) { body.held = false; body.linear = vec(velocity); body.angular = vec(spin); } },
    isHeld: body => body.held,
    onContact(cb) { contactListeners.add(cb); return () => contactListeners.delete(cb); },
    onStep(cb) { stepListeners.add(cb); return () => stepListeners.delete(cb); },
    remove(body) { body.removed = true; bodies.delete(body); fake.log.push(['remove', body]); },

    /** Queue a report for the next step: { a, speed, point, normal, … } as in the interface. */
    contact(report) { queued.push({ b: null, surface: null, ...report }); },
    step(dt = 1 / 60) {
      for (const c of queued.splice(0)) if (!c.a.removed) for (const cb of [...contactListeners]) cb(c);
      for (const cb of [...stepListeners]) cb(dt);
    },
  };
  return fake;
}
