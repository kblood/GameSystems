class_name GSBatteryAdapter
extends RefCounted
## Finite reversible battery API compatible with Aster's external power adapter.

var reversible := true
var capacity_wh: float
var energy_wh: float
var nominal_voltage: float
var enabled: bool
var _valid := false

func _init(capacity: float = 720.0, energy: float = 540.0, voltage: float = 12.6, is_enabled: bool = true) -> void:
	if not valid_configuration(capacity, energy, voltage, is_enabled):
		push_error("GSBatteryAdapter requires positive finite capacity/voltage and energy within capacity")
		return
	capacity_wh = capacity
	energy_wh = energy
	nominal_voltage = voltage
	enabled = is_enabled
	_valid = true

func is_valid() -> bool:
	return _valid

func state() -> Dictionary:
	if not _valid: return {}
	var voltage := nominal_voltage if enabled and energy_wh > 0.0 else 0.0
	return {"energyWh": energy_wh, "capacityWh": capacity_wh, "voltage": voltage, "enabled": enabled}

## Actual supplied Wh. Disabled or empty batteries supply no energy.
func draw(wh: float) -> float:
	if not _valid or not _finite_nonnegative(wh) or wh <= 0.0 or not enabled: return 0.0
	var actual := minf(wh, energy_wh)
	energy_wh -= actual
	return actual

## Actual accepted Wh. A draw can be refunded exactly while its freed capacity remains available.
func charge(wh: float) -> float:
	if not _valid or not _finite_nonnegative(wh) or wh <= 0.0: return 0.0
	var actual := minf(wh, capacity_wh - energy_wh)
	energy_wh += actual
	return actual

func set_enabled(value: bool) -> void:
	if _valid: enabled = value

static func _finite_nonnegative(value: Variant) -> bool:
	return typeof(value) in [TYPE_INT, TYPE_FLOAT] and is_finite(float(value)) and float(value) >= 0.0

static func _positive_finite(value: Variant) -> bool:
	return typeof(value) in [TYPE_INT, TYPE_FLOAT] and is_finite(float(value)) and float(value) > 0.0

static func valid_configuration(capacity: Variant, energy: Variant, voltage: Variant, is_enabled: Variant) -> bool:
	return _positive_finite(capacity) and _finite_nonnegative(energy) and float(energy) <= float(capacity) \
		and _positive_finite(voltage) and typeof(is_enabled) == TYPE_BOOL
