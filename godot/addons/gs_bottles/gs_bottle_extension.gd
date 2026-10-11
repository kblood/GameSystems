class_name GSBottleExtension
extends GSExtension
## GSHost lifecycle and event bridge for the reusable bottle core.

const ID := &"gs_bottles"
const QUALITY := ["minimal", "low", "medium", "high"]

var _context: GSContext
var _scope: Node
var _tree: SceneTree
var _manager: GSBottleBreakManager
var _owns_manager := false
var _tracked: Dictionary = {} # instance id -> weakref


func init_extension(context: GSContext) -> Variant:
	super.init_extension(context)
	_context = context
	_scope = context.scene_root
	if not is_instance_valid(_scope) or not _scope.is_inside_tree():
		return null
	_tree = _scope.get_tree()
	_manager = GSBottleBreakManager.find_for(_scope)
	if _manager == null:
		_manager = GSBottleBreakManager.new()
		_manager.name = "GSBottleBreakManager"
		_scope.add_child(_manager)
		_owns_manager = true
	_tree.node_added.connect(_on_node_added)
	_tree.node_removed.connect(_on_node_removed)
	_scan(_scope)
	set_quality(StringName(context.quality))
	return self


func set_quality(tier: StringName) -> bool:
	if not is_instance_valid(_manager):
		return false
	match String(tier):
		"minimal": _manager.set_quality(GSBottleBreakManager.Quality.MINIMAL)
		"low": _manager.set_quality(GSBottleBreakManager.Quality.LOW)
		"medium": _manager.set_quality(GSBottleBreakManager.Quality.MEDIUM)
		"high": _manager.set_quality(GSBottleBreakManager.Quality.HIGH)
		_: return false
	return true


func update_extension(_dt: float) -> bool:
	return is_instance_valid(_manager)


func get_manager() -> GSBottleBreakManager:
	return _manager if is_instance_valid(_manager) else null


## Creates an ordinary reusable bottle and adds it to `parent` (or this mission).
func create_bottle(style: String = "wine", fill: float = 0.6, parent: Node = null) -> GSBreakableBottle:
	if _context == null or not is_instance_valid(_scope):
		return null
	var asset_root := String(_context.options.get("asset_root", "assets/game_systems/bottles/"))
	var bottle := GSBreakableBottle.create(style, fill, _context.asset_path(asset_root))
	_track_bottle(bottle)
	(parent if is_instance_valid(parent) else _scope).add_child(bottle)
	return bottle


func track_bottle(bottle: GSBreakableBottle) -> void:
	_track_bottle(bottle)


func dispose_extension() -> void:
	if _tree != null and is_instance_valid(_tree) and _tree.node_added.is_connected(_on_node_added):
		_tree.node_added.disconnect(_on_node_added)
	if _tree != null and is_instance_valid(_tree) and _tree.node_removed.is_connected(_on_node_removed):
		_tree.node_removed.disconnect(_on_node_removed)
	for ref: WeakRef in _tracked.values():
		var bottle: Variant = ref.get_ref()
		if is_instance_valid(bottle):
			var callback := _on_broken.bind(bottle)
			if bottle.broke.is_connected(callback):
				bottle.broke.disconnect(callback)
	_tracked.clear()
	if _owns_manager and is_instance_valid(_manager):
		_manager.queue_free()
	_context = null
	_scope = null
	_tree = null
	_manager = null
	_owns_manager = false


func _scan(node: Node) -> void:
	if node is GSBreakableBottle:
		_track_bottle(node as GSBreakableBottle)
	for child in node.get_children():
		_scan(child)


func _on_node_added(node: Node) -> void:
	if _context != null and is_instance_valid(_scope) and node is GSBreakableBottle and _scope.is_ancestor_of(node):
		_track_bottle(node as GSBreakableBottle)


func _on_node_removed(node: Node) -> void:
	if node is GSBreakableBottle:
		_untrack_bottle(node as GSBreakableBottle)


func _track_bottle(bottle: GSBreakableBottle) -> void:
	if not is_instance_valid(bottle):
		return
	var key := bottle.get_instance_id()
	if _tracked.has(key):
		return
	_tracked[key] = weakref(bottle)
	bottle.broke.connect(_on_broken.bind(bottle), CONNECT_ONE_SHOT)


func _on_broken(at: Vector3, energy: float, kind: StringName, bottle: GSBreakableBottle) -> void:
	_untrack_bottle(bottle)
	if _context != null:
		_context.emit(&"broken", {"body": bottle, "at": at, "energy": energy, "kind": kind})


func _untrack_bottle(bottle: GSBreakableBottle) -> void:
	if not is_instance_valid(bottle):
		return
	var key := bottle.get_instance_id()
	if not _tracked.has(key):
		return
	var callback := _on_broken.bind(bottle)
	if bottle.broke.is_connected(callback):
		bottle.broke.disconnect(callback)
	_tracked.erase(key)
