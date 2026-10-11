// Composition using public events/APIs only; no bottle internals.
const bindings = new WeakMap();
export function connectBottlePools({ host, bottles, pools }) {
  if (typeof bottles?.consumePuddleVolume !== 'function' || typeof bottles?.removePuddleVolume !== 'function')
    throw new TypeError('Bottle runtime needs burn/remove sinks');
  if (bindings.has(bottles)) throw new Error('Bottle runtime already has a pool owner; disconnect before rebinding');
  const sourceKey = bottles.sourceKey ?? 'bottles';
  const options = event => ({ surfaceId: event.surfaceId, position: event.position });
  const offBurn = host.on('pools:consumed', event => {
    const ml = event.sourceVolumes?.[sourceKey] ?? 0;
    if (ml > 0) bottles.consumePuddleVolume(ml, options(event));
  });
  const offRemove = host.on('pools:removed', event => {
    const ml = event.sourceVolumes?.[sourceKey] ?? 0;
    if (ml > 0) bottles.removePuddleVolume(ml, options(event));
  });
  const offReset = host.on('bottles:reset', () => pools.removeSource(sourceKey));
  let closed = false;
  const disconnect = () => {
    if (closed) return; closed = true;
    offBurn(); offRemove(); offReset(); bindings.delete(bottles);
  };
  bindings.set(bottles, disconnect);
  return disconnect;
}
