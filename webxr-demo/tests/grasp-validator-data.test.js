import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import DATA from '../../extensions/grasp/data/validator.data.json' with { type: 'json' };
import { HARD, COMFORT, GATES, clampRows } from '../../extensions/grasp/grasp_validator.js';

test('versioned grasp data preserves all pre-extraction public constant values', () => {
  assert.equal(DATA.schema, 'gamesystems.grasp-validator-data.v1');
  assert.deepEqual({ HARD, COMFORT, GATES }, { HARD: DATA.HARD, COMFORT: DATA.COMFORT, GATES: DATA.GATES });
  // Captured from the public exports before replacing the original JS literals.
  const historical = 'ac61e31e5a3b19f979c6af635533ecee706be48dc66464a7a52b7e73f4716ed5';
  assert.equal(createHash('sha256').update(JSON.stringify({ HARD, COMFORT, GATES })).digest('hex'), historical);
});

test('validator keeps its degree-based clamp and non-finite fallback after data extraction', () => {
  const rows = clampRows({ Thumb: [-100, 100, -100, 100, 100], Index: [NaN, NaN, NaN, NaN] });
  assert.deepEqual(rows.Thumb, [-55, 65, -25, 95, 45]);
  assert.deepEqual(rows.Index, [0, 50, 55, 35]);
  assert.deepEqual(rows.Middle, [0, 55, 60, 40]);
});
