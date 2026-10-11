import { positive } from '../host/system.js';

export const copySources = sources => Object.fromEntries(Object.entries(sources).map(([key, parts]) => [key, { ...parts }]));
export const sourceVolumes = sources => Object.fromEntries(Object.entries(sources).map(([key, parts]) => [key, Object.values(parts).reduce((n, ml) => n + ml, 0)]));

export function addSource(sources, key, components) {
  if (typeof key !== 'string' || !key) throw new TypeError('Invalid liquid source key');
  if (!Object.hasOwn(sources, key)) sources[key] = {};
  for (const [kind, ml] of Object.entries(components)) sources[key][kind] = (sources[key][kind] ?? 0) + ml;
}

export function parseSources(raw, components, presets) {
  const sources = Object.create(null), sums = {};
  // Earlier snapshots did not distinguish a hose from bottles. Do not debit an invented source.
  if (raw === undefined) { addSource(sources, 'untracked', components); return sources; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid liquid sources');
  for (const [key, parts] of Object.entries(raw)) {
    if (!key || !parts || typeof parts !== 'object' || Array.isArray(parts)) throw new Error('Invalid liquid source');
    const clean = {};
    for (const [kind, ml] of Object.entries(parts)) {
      if (!Object.hasOwn(presets, kind)) throw new Error('Unknown source component');
      clean[kind] = positive(ml, 'source component ml', true); sums[kind] = (sums[kind] ?? 0) + ml;
    }
    addSource(sources, key, clean);
  }
  for (const kind of new Set([...Object.keys(sums), ...Object.keys(components)]))
    if (Math.abs((sums[kind] ?? 0) - (components[kind] ?? 0)) > 1e-5) throw new Error('Sources disagree with liquid components');
  return sources;
}

export function burnSources(sources, fraction, presets) {
  const consumed = Object.create(null);
  for (const [key, parts] of Object.entries(sources)) {
    let removed = 0;
    for (const kind of Object.keys(parts)) if (presets[kind].fuelJPerMl) {
      const ml = parts[kind] * fraction; parts[kind] = Math.max(0, parts[kind] - ml); removed += ml;
    }
    consumed[key] = removed;
  }
  return consumed;
}
