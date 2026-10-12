# Game performance for all platforms

Optimize measured bottlenecks against a named target and representative workload.
Performance problems usually appear as sustained frame cost, intermittent spikes,
loading delays, memory pressure or network stalls; each needs a different investigation.
Godot's [optimization guide](https://docs.godotengine.org/en/stable/tutorials/performance/general_optimization.html)
has engine-specific profiler and tooling references.

## Define a budget

For each target platform, write down frame rate/frame-time goal, CPU and GPU allowance,
memory ceiling, load-time goal, worst-case entity/content count and network conditions.
Track p50/p95/p99 and worst sustained frame time. Averages can hide stutter. Keep
separate budgets for gameplay, rendering, physics, audio, UI, loading and background work.

## Find the actual cost

Reproduce a representative scene and profile a release-like build. Use engine profilers,
GPU tools, allocation/heap views, I/O traces and network statistics as appropriate.
Compare a baseline and one change at a time. Distinguish algorithm cost from driver,
shader compilation, asset loading, operating-system scheduling and thermal effects.
Measure target hardware; editor performance is only a development signal.

## Common improvements

- Reduce work: spatially partition queries, cache stable results, avoid repeated scans,
  and cap simulation/AI updates.
- Reduce data movement: batch where useful, reuse buffers, avoid hot-path allocations,
  and stream assets by visibility/need.
- Reduce rendering cost: level of detail, occlusion, culling, instancing, simpler
  materials, fewer shadow casters and controlled transparency.
- Reduce physics cost: simple colliders, explicit collision masks, bounded active-body
  counts, tuned solver/substep counts and sleep for inactive bodies.
- Reduce stalls: preload or asynchronously load, compile shaders ahead where possible,
  avoid synchronous file/network work and spread large tasks over frames.
- Preserve quality intelligently: tier optional detail by platform, distance, visibility
  and activity while keeping rules and player feedback consistent.

## Maintainability and regressions

Keep a small repeatable benchmark scene and record hardware, build type, engine version,
settings and content. Add budgets to CI only when the runner is stable enough to make
them meaningful. Profile again after changes to renderer, physics, assets or architecture.
Do not trade correctness, accessibility or predictable interactions for a benchmark that
does not represent play.
