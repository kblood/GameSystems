# gs_gear_inventory licence and origin

- Licence: MIT, copyright (c) 2026 Kasper Olesen. Full text: `LICENSE` copied from the GameSystems repository root.
- Origin: original, engine-independent GDScript ownership ledger for physical game gear. It does not perform XR input, scene reparenting, physics queries, or rendering.
- Source of truth: `GameSystems/godot/addons/gs_gear_inventory`. Games receive generated copies with `godot/tools/sync_addons.py`; do not edit generated game copies.
- API/lifecycle: call `add_slot(id, allowed_categories, max_size)` then `register_item(id, object_ref, category, size, initial_owner)`. `store` and `retrieve` perform validated atomic ledger transitions; the game host reparents only after success. `capture` -> `prepare_restore` -> `commit_restore` validates checkpoints without partial mutation. `reset` returns registered items to their initial owners and `dispose` is idempotent and releases retained references.
- Scene-host reconciliation: after `reset` or `commit_restore`, the caller must enumerate the ledger and reconcile every live item node to its authoritative owner/slot before gameplay resumes. These bulk operations intentionally do not emit per-item `ownership_changed` feedback events. Before `dispose`, the host must detach or otherwise release its scene references because the ledger clears its item lookup.
- Transition observers run synchronously; ledger mutation is rejected while `ownership_changed` callbacks are running, so a listener cannot invalidate the transition before the caller updates the scene tree.
- Checkpoint restore requires an integer version and string owner, slot and item-claim IDs; it rejects type coercion rather than normalizing malformed values.
- Owner strings are `world`, `hand:left`, `hand:right`, or the ledger-owned `slot`. Slot/item dimensions are canonicalized by axis, allowing rotated fit checks. Stable item IDs must be unique within one inventory instance.
