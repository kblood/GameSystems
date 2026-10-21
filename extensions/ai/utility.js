// GameSystems ai extension: the utility scorer brains use to pick a goal. Pure and deterministic: each goal scores the
// context (0..1, any finite number works), the current goal gets a hysteresis bonus so choices do not flicker, ties go to
// the goal listed first. Randomness, when a brain wants it, comes in through the context (the agent's seeded rng).
//
//   const pick = createUtility([
//     { id: 'chase', score: c => c.contact ? 1 : 0 },
//     { id: 'wander', score: c => 0.2 },
//   ], { hysteresis: 0.1 })
//   pick.choose(ctx, current) -> 'chase'; pick.scores (last scores, for debugging)

export function createUtility(goals, { hysteresis = 0.1 } = {}) {
  const scores = Object.fromEntries(goals.map(g => [g.id, 0]));
  return {
    goals, scores,
    choose(ctx, current = null) {
      let best = null, bestScore = -Infinity;
      for (const g of goals) {
        let s = g.score(ctx);
        if (!Number.isFinite(s)) s = 0;
        scores[g.id] = s;
        if (g.id === current && s > 0) s += hysteresis;
        if (s > bestScore) { bestScore = s; best = g.id; }
      }
      return best;
    },
  };
}
