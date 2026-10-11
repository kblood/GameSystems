class_name GSQuality
extends RefCounted
## Quality tiers, a 1:1 port of GameSystems/extensions/host/quality.js (golden: data/tier_for.golden.json).
## The game has one global level (0 = minimal ... max_level = highest, default 0-3); every extension declares its own
## ordered tier names, e.g. ["off", "low", "high"]. A level maps onto the tiers by rounding up, so the lowest level picks
## the first tier (usually "off"), the highest picks the last, and every level above the lowest leaves an "off"-first
## extension switched on. Tiers can also be pinned per extension (GSHost.set_tier).

const DEFAULT_TIERS: PackedStringArray = ["off", "on"]

## Tier name for a global level; null when tiers is empty.
static func tier_for(tiers: PackedStringArray = DEFAULT_TIERS, level: float = 0.0, max_level: float = 3.0) -> Variant:
	if tiers.is_empty(): return null
	if not (max_level > 0.0): return tiers[tiers.size() - 1] # also NaN, like JS !(maxLevel > 0)
	var t := level / max_level
	if is_nan(t): t = 0.0
	t = clampf(t, 0.0, 1.0)
	var index := int(ceil(t * (tiers.size() - 1) - 1e-9))
	return tiers[mini(tiers.size() - 1, maxi(0, index))]

## Accepts a tier name or an index into tiers; returns the tier name, or null when it is not one of the tiers.
static func normalize_tier(tiers: PackedStringArray, tier: Variant) -> Variant:
	if typeof(tier) == TYPE_INT:
		return tiers[tier] if tier >= 0 and tier < tiers.size() else null
	if typeof(tier) == TYPE_STRING or typeof(tier) == TYPE_STRING_NAME:
		return String(tier) if tiers.has(String(tier)) else null
	return null

## "off" is the only tier the host treats specially: update_extension() is not called and processing is switched off.
static func is_off(tier: Variant) -> bool:
	return tier != null and String(tier) == "off"

## Any Array/PackedStringArray of names -> PackedStringArray; empty/invalid -> DEFAULT_TIERS.
static func tiers_of(value: Variant) -> PackedStringArray:
	var out := PackedStringArray()
	if value is Array or value is PackedStringArray:
		for name in value: out.append(String(name))
	return out if not out.is_empty() else DEFAULT_TIERS
