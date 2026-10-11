// Public JSON-state helpers. Owners return silent commit plans; observers run after a complete checkpoint commit.
export function jsonState(value, { maxBytes = 2 * 1024 * 1024 } = {}) {
  let nodes = 0;
  function visit(v, depth) {
    if (++nodes > 200000 || depth > 32) throw new RangeError('State structure exceeds budget');
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return;
    if (typeof v === 'number') { if (!Number.isFinite(v)) throw new TypeError('State numbers must be finite'); return; }
    if (!v || typeof v !== 'object') throw new TypeError('State must contain JSON values');
    const proto = Object.getPrototypeOf(v);
    if (!Array.isArray(v) && proto !== Object.prototype && proto !== null) throw new TypeError('State objects must be plain');
    for (const item of Array.isArray(v) ? v : Object.values(v)) visit(item, depth + 1);
  }
  visit(value, 0);
  const text = JSON.stringify(value);
  if (new TextEncoder().encode(text).length > maxBytes) throw new RangeError('State exceeds byte budget');
  return JSON.parse(text);
}

export function stateId(value, label = 'id') {
  if (typeof value !== 'string' || !value) throw new TypeError(`${label} needs a nonempty string`);
  return value;
}

export function booleanState(value, label = 'flag') {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be boolean`);
  return value;
}
