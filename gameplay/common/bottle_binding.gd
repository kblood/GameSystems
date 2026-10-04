class_name BottleBinding
extends Node
## Child node every BottleFactory bottle carries. Event driven (no _process): applies QualityTier changes, per-object tier
## override, mesh / label LOD swaps (refresh()), the right liquid sidecar and carbonation override, and hooks audio.
## Public: tier_override (-1 = follow QualityTier), refresh(), effective_tier(), info (resolved asset dictionary).

var body: Node3D
var info: Dictionary = {}
var tier_override := -1
var carbonation := -1.0
var audio := true
var lod_override := -1
var pour: BottlePour          ## set by BottleFactory (opts.pour); null when pouring is off
var _variant := ""
var _applied_tier := -1


func effective_tier() -> int:
	return tier_override if tier_override >= 0 else QualityTier.tier


func _ready() -> void:
	QualityTier.tier_changed.connect(_on_tier)
	call_deferred("_late_setup")   # after the body's own _ready (children are ready first)


func _late_setup() -> void:
	if not is_instance_valid(body) or not body.is_inside_tree():
		return
	var m := BottleBreakManager.get_for(self)
	if m.quality != QualityTier.tier:
		m.set_quality(QualityTier.tier)
	_variant = BottleFactory.variant_path(info, effective_tier(), _lod())
	if _variant != String(info["glb"]):
		BottleFactory.swap_model(body, _variant)
	apply_liquid()
	if audio:
		AudioHub.watch(body)


func _on_tier(_t: int) -> void:
	if tier_override < 0:
		refresh()


## Re-evaluate tier + distance LOD (cheap). Call after the camera moved a lot (BottleFactory.refresh_all does it for all bottles).
func refresh() -> void:
	if not is_instance_valid(body) or not body.is_inside_tree() or body.state != &"intact":
		return
	var v := BottleFactory.variant_path(info, effective_tier(), _lod())
	if v != _variant:
		_variant = v
		BottleFactory.swap_model(body, v)
		_applied_tier = -1
	if _applied_tier != effective_tier():
		apply_liquid()


func apply_liquid() -> void:
	var ctl: BottleLiquid = body.ctl
	var t := effective_tier()
	_applied_tier = t
	ctl.quality = QualityTier.liquid_quality(t)
	ctl.lod_distances = QualityTier.LIQUID_LOD[t]
	ctl.setup(body.model, body.fill, BottleFactory.liquid_sidecar(info, ctl.quality))
	if carbonation >= 0.0:
		ctl.carbonation = carbonation
	if pour and is_instance_valid(pour):
		pour.quality = ctl.quality   # stored only: HIGH is the one implemented stream mode
		pour.activate()               # mouth / LUT were rebuilt by setup()


func _lod() -> int:
	if lod_override >= 0:
		return lod_override
	var cam := body.get_viewport().get_camera_3d() if body.is_inside_tree() else null
	if cam == null:
		return 0
	return QualityTier.mesh_lod(cam.global_position.distance_to(body.global_position), effective_tier())
