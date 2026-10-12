# Weapon catalog validation

`godot/addons/gs_weapon_catalog` validates data-only weapon definitions. It does
not create `WeaponState` or model assets; game adapters own those responsibilities.
Keep parser limits aligned with the runtime that consumes the profile. Current
firearm profiles support magazine capacities from 1 through 128 rounds, firing
intervals from 0.03 through 2 seconds, and the `semi` and `auto` mode enums.
`default_fire_mode` defaults to `semi`, must be a supported enum, and must also
appear in `fire_modes`. Duplicate and unknown modes are rejected. Melee weapons
cannot declare capacity, firing modes or a firearm `shot_profile`.

Optional `shot_profile` values are validated against runtime limits and carried
with each `GSWeaponDefinition`: effective range, recoil and recovery, supported
weapon recoil/haptic output, haptic duration, and muzzle-flash duration/energy.
Missing fields use Kestrel-compatible defaults (including 70 m range). Morrow,
Tern and Rook author their own range and recoil values in `catalog.json`; the
deterministic asset builder keeps those gameplay fields alongside model metadata.
The selected `WeaponState` owns the profile, so switching variants cannot inherit
the previous firearm's tuning. Damage and ammunition remain owned by their
existing systems.

The bounds prevent a catalog from loading successfully only for its gameplay
adapter to reject the profile later. Test the source package with:

```powershell
& $GodotExe --headless --path godot --script res://tests/gs_weapon_catalog_tests.gd
```

The generated game copy is tested through the consuming game's weapon-catalog
suite. Synchronize it with `python godot/tools/sync_addons.py <game> gs_weapon_catalog`;
do not patch the generated copy directly.
