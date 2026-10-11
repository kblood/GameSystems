# Gear inventory persistence

`gs_gear_inventory` checkpoints describe stable ownership only: item IDs, owner IDs,
slot IDs, and the reverse slot claims. Scene `Node` references, item-specific state,
and free-world transforms remain owned by the host and by each gameplay system.

For a fresh scene restore, rebuild the backpack anchors and item nodes first. Register
the same stable slot and item IDs with the same category/size profiles, then pass the
saved checkpoint to `restore_inventory()`. A missing or changed ID/topology rejects
the restore before any ownership or scene parent is changed. The checkpoint is plain
JSON data and its schema version accepts the integral float form produced by Godot's
JSON decoder while rejecting fractional versions.

This boundary lets a game save an ordinary tool or supply item in a backpack without
duplicating its ammo, fluid, durability, or world pose. The owning gameplay/scene
system serializes those values; the gear inventory restores where the object belongs.
The magazine and weapon systems remain authoritative for ammunition and weapon state.
