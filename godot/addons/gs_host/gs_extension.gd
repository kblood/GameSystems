class_name GSExtension
extends Node
## Optional base for node extensions. GSHost accepts any Object with the same members (duck-typed): a Node, a
## RefCounted, or a Script / PackedScene / resource path that instantiates one. Declare in the subclass:
##   const ID := &"my_ext"                            required, unique
##   const REQUIRES := [&"gs_grasp"]                  optional; extensions that must be ready before this one loads
##   const QUALITY := ["off", "low", "high"]          optional ordered tiers (default ["off", "on"])
##   func init_extension(ctx: GSContext) -> Variant   required; returns the public api (any non-null value, e.g. self
##                                                    or a Dictionary). null = failed. Do setup here, not in _ready
##                                                    (the host adds a node to the tree before calling this).
##   func update_extension(dt: float) -> bool         optional, every frame while the tier is not "off"; return true.
##   func set_quality(tier: StringName) -> bool       optional; return true.
##   func dispose_extension() -> void                 optional cleanup; the host frees the nodes it added.
## Fault isolation: a call that returns false (init: null) or raises a script error (counted by gs_error_trap.gd in
## debug builds; a typed "-> bool" function that crashes also returns false) disposes only that extension. Call
## ctx.fail(reason) to give up explicitly. While the tier is "off" a node's _process/_physics_process are switched off.

const Context = preload("gs_context.gd")

var ctx: Context

func init_extension(context: Context) -> Variant:
	ctx = context
	return self
