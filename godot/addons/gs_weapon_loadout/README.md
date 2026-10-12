# GS Weapon Loadout

`GSWeaponLoadout` retains independent live runtime entries and coordinates a
host's atomic selection transition. It deliberately does not instantiate weapon
scenes, own inventory slots, interpret hand input, or define ammo and combat
rules. Store each weapon's mutable state and its matching presentation/runtime
objects together so magazine tokens and other state remain attached to the
weapon that created them.

```gdscript
const Loadout = preload("res://addons/gs_weapon_loadout/gs_weapon_loadout.gd")

var loadout := Loadout.new()
loadout.add_entry(&"kestrel", kestrel_state, kestrel_model,
	{"magazine_factory": kestrel_magazine_factory})
loadout.add_entry(&"shear", shear_state, shear_model,
	{"melee_contact": shear_contact})

func switch_weapon(next_id: StringName) -> Dictionary:
	return loadout.select(next_id, _can_switch_weapon, _apply_weapon_switch)
```

`add_entry(id, state, presentation = null, metadata = {})` rejects empty IDs,
null state, and duplicates. `get_entry(id)`, `active_entry()`, `active_id()`, and
`entry_ids()` inspect registered entries. `remove_entry(id)` refuses to remove
the active entry. Entries retain their state and presentation references until
explicit removal.

`select(id, can_switch = Callable(), apply_switch = Callable())` first checks
that the target exists, then calls the optional read-only policy callback with
`(previous_entry, candidate_entry)`. It requires an apply callback for a real
change. The host callback must make its live binding transition atomically and
return `true` or `{"ok": true}` only after success. A failed policy or apply
leaves the registry's active ID unchanged and emits no signal. The registry
updates the active ID and emits `active_entry_changed(previous_id, active_id)`
only after the host reports success. Entry mutation and nested selection stay
locked through the synchronous notification, so every listener observes the same
committed transition. A callback returning false must not leave
partial host changes behind; the host owns that rollback guarantee.

`restore_active_entry(id)` is a narrow trusted-host seam for checkpoint
transactions. It only publishes an existing entry ID and emits the normal
change signal; it does not validate or apply scene/state changes. Call it only
after the host has validated the complete checkpoint and committed every live
weapon state and ownership transition. It refuses calls during a selection
callback and leaves the active ID unchanged for unknown entries.

For a Godot player, the apply callback should reject switches while hands own
items, a magazine or mechanism is active, or a melee action is latched. It can
then bind the candidate's state, scene, presenter, magazine factory, and contact
adapter as one staged transition. Physical storage and retrieval remain the
inventory system's responsibility.

Run the source contract with:

```powershell
godot --headless --path godot --script res://tests/gs_weapon_loadout_tests.gd
```
