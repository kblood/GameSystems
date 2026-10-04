extends Node
## Autoload "QualityTier": ONE realism setting for the bottle library. set_tier(t) drives
##   - BottleLiquid.quality (HIGH 3 .. MINIMAL 0) and its distance LOD cut-offs,
##   - BottleBreakManager.set_quality (shards, droplets, puddles, fatigue),
##   - the label/design tier (high / medium / low / minimal GLB variants),
##   - the mesh LOD distances (v2 _lod1/_lod2, container _lod1) used by BottleFactory / BottleBinding.
## Event driven: nothing here runs per frame. Bottles listen to `tier_changed` through their BottleBinding.
## Per object override: BottleBinding.tier_override (or spawn opts.tier).
signal tier_changed(tier: int)

enum { HIGH, MEDIUM, LOW, MINIMAL }
const NAMES := ["HIGH", "MEDIUM", "LOW", "MINIMAL"]
const LIQUID_QUALITY := [3, 2, 1, 0]
const LABEL_TIER := ["high", "medium", "low", "minimal"]
## BottleLiquid.lod_distances per tier: beyond x -> MEDIUM liquid, y -> LOW, z -> MINIMAL
const LIQUID_LOD := [Vector3(0.9, 2.5, 6.0), Vector3(0.6, 1.8, 4.0), Vector3(0.4, 1.0, 2.5), Vector3(0.2, 0.5, 1.0)]
## mesh LOD: beyond x metres use lod1, beyond y use lod2
const MESH_LOD := [Vector2(3.0, 8.0), Vector2(2.0, 5.0), Vector2(1.2, 3.0), Vector2(0.6, 1.5)]

var tier := HIGH


func _ready() -> void:
	call_deferred("_apply_break_manager")


func set_tier(t: int) -> void:
	t = clampi(t, HIGH, MINIMAL)
	if t == tier:
		return
	tier = t
	_apply_break_manager()
	tier_changed.emit(t)


func tier_name(t := -1) -> String:
	return NAMES[tier if t < 0 else t]


func liquid_quality(t := -1) -> int:
	return LIQUID_QUALITY[tier if t < 0 else t]


func label_tier(t := -1) -> String:
	return LABEL_TIER[tier if t < 0 else t]


## 0 = full mesh, 1 = lod1, 2 = lod2 for a bottle `dist` metres from the camera at tier `t`.
func mesh_lod(dist: float, t := -1) -> int:
	var c: Vector2 = MESH_LOD[tier if t < 0 else t]
	return 2 if dist > c.y else (1 if dist > c.x else 0)


func _apply_break_manager() -> void:
	BottleBreakManager.default_quality = tier as BottleBreakManager.Quality
	var m := BottleBreakManager.current
	if m == null or not is_instance_valid(m):
		m = BottleBreakManager.get_for(self)
	if m.quality != tier:
		m.set_quality(tier)
