# gs_cameras

Godot-native shared camera feeds for in-world monitor meshes. The scene owns its
source `Camera3D` nodes, worlds, and screen meshes. `GSCameraSystem` owns one
`SubViewport`, mirror camera and texture per feed, plus one display material per
screen. Multiple screens selecting a feed use the same texture and render request.

```gdscript
const Cameras = preload("res://addons/gs_cameras/gs_camera_system.gd")

func _ready() -> void:
    var cameras := Cameras.new()
    cameras.configure({"quality": "mid", "screen_layer": 20})
    add_child(cameras)
    cameras.add_feed(&"hall", {"camera": $HallCamera, "aspect": 16.0 / 9.0})
    cameras.add_feed(&"garage", {"camera": $GarageCamera})
    cameras.add_screen(&"desk", {"mesh": $Monitor/Display, "feed_id": "hall"})
    cameras.switch_feed(&"desk", "garage")
    cameras.set_screen_enabled(&"desk", false)
```

Check returned booleans when loading authored data. Invalid registration/mutation
returns `false` without changing state; missing/disposed state reads return `{}`,
and missing textures return `null`. Feed/screen IDs are nonblank, at most 128
characters. Call `dispose()` for early cleanup; leaving the scene tree also
disposes the system permanently. Cameras and screens must be in the scene tree
when registered. The system node must be in the tree before adding feeds.

## API

| Method | Contract |
| --- | --- |
| `configure(options) -> bool` | Before registration; `quality`, `max_feeds`, `max_screens`, `screen_layer`. Limits may be configured up to the hard 16/32 caps. |
| `add_feed(id, values) -> bool` | Required `camera`; optional `aspect` (16:9), `enabled` (true), `label` (ID), `world_3d` (source camera's world). |
| `add_screen(id, values) -> bool` | Required `mesh`; optional `feed_id` (null), `enabled` (true). |
| `feed_state(id) -> Dictionary` | ID, enabled, aspect, completed `frames`, width, height, and `pending`. |
| `screen_state(id) -> Dictionary` | ID, nullable `feed_id`, enabled. |
| `feed_options(screen_id) -> Array[Dictionary]` | Feed IDs/labels, enabled, selected for menus. |
| `texture(feed_id) -> Texture2D` | Borrowed shared viewport texture; valid only while feed exists. |
| `switch_feed(screen_id, feed_id) -> bool` | Select a registered feed, or null to disconnect. |
| `set_feed_enabled(id, value)`, `set_screen_enabled(id, value) -> bool` | Strict boolean flags; switching off cancels unnecessary pending requests. |
| `remove_feed(id)`, `remove_screen(id) -> bool` | Release owned resources; removing a feed disconnects its screens. |
| `set_quality(tier) -> bool` | Resize bounded targets, cancel pending renders, blank until a fresh image. |
| `step(delta) -> Dictionary` | Manual scheduling: `{ok, scheduled, pending}`; finite nonnegative seconds. |
| `stats() -> Dictionary` | Tier, limits, registry sizes, completed frames, pending requests and tier budgets. |
| `checkpoint() -> Dictionary` | JSON-compatible topology references and enable flags. |
| `prepare_restore(payload) -> Dictionary` | `{ok: false}` or `{ok: true, commit: Callable}`; validation has no effects. |
| `restore_checkpoint(payload) -> bool` | Validate then commit atomically. |
| `dispose()` | Idempotent release; this system cannot be reused afterward. |

Registration dictionaries reject unknown options. Source cameras must use
perspective projection; aspect is explicit because Godot derives camera aspect
from its viewport. Keep it between 0.25 and 4.0. Position, perspective optics,
offsets, cull mask, environment and camera attributes are copied before each
scheduled capture. The source camera's parent, current flag, and resources are
never changed. A feed follows its source camera's current `World3D` unless an
explicit world is supplied. Host scripts, compositor callbacks and audio listeners
are not copied. The mirror cameras always use monoscopic viewports with XR off.

Screens require a one-surface `MeshInstance3D` with authored UVs and no
`material_overlay`. A mesh cannot be registered twice or to two camera systems.
The original mesh resource, surface materials and geometry remain untouched.

## Rendering and visibility

| Tier | Maximum texture dimension | Maximum frames/s per feed | Maximum pending requests |
| --- | ---: | ---: | ---: |
| minimal | 128 | 2 | 1 |
| low | 256 | 4 | 1 |
| mid | 512 | 8 | 2 |
| high | 1024 | 15 | 2 |

Both dimensions are bounded, including portrait feeds. Round-robin selection
serves enabled feeds selected by at least one enabled, bound screen whose
`is_visible_in_tree()` is true. Hidden parents count. This is visibility-flag
filtering, not frustum, distance, or occlusion detection. An off or disconnected
screen displays a dark material. A disabled feed blanks all its screens.
Screens that are freed or removed from the tree stop requesting captures; feeds
with a freed, detached or invalid source camera also stop and blank their screens.
Explicitly remove registrations to release their registry slots and textures.

`auto_update` defaults to true. Set it to false to drive `step(delta)` yourself;
use one time source. `step()` schedules `SubViewport.UPDATE_ONCE` requests; it
does not synchronously render. The budget covers requests in flight across
repeated calls, and no lost frames are caught up. `frame_pre_draw` rechecks
selection/visibility and copies the current source pose; `frame_post_draw`
completes the pending requests and exposes their texture on screens. `frames`
counts completed requested draw cycles, not independent GPU timing measurements.
The dummy headless renderer cannot validate image contents. Native draw semantics:
[SubViewport](https://docs.godotengine.org/en/stable/classes/class_subviewport.html)
and [RenderingServer frame signals](https://docs.godotengine.org/en/stable/classes/class_renderingserver.html#signals).

**Reserve one render layer for monitor faces** (default layer 20). The addon sets
registered screen meshes exclusively to that layer and excludes it from every
feed camera's cull mask. Player/viewer cameras must include this layer; the default
camera mask does. This prevents viewport feedback while keeping screens visible
to the player. Reserve the same screen layer across camera systems sharing a
world. Keep other scene geometry off that layer if feeds must capture it.
Do not put the returned texture on additional, unregistered meshes visible to a
feed camera, or manually alter the addon's viewport/material children.

While a mesh is registered, the addon owns its `material_override` and layer
assignment. If the host replaces either, that screen stops requesting/displaying
feeds. Removal/disposal restores each original value only if that property still
has the addon's assigned value, preserving host replacements. Ownership metadata
is removed and owned materials drop their texture references. Render callbacks
are disconnected and viewports are freed; host cameras/worlds/materials survive.

## Checkpoints and host integration

`checkpoint()` emits schema `gamesystems.godot.cameras.v1`, feeds with `{id, enabled}`,
and screens with `{id, enabled, feed_id}`. IDs in the snapshot are JSON strings;
`feed_id` is a registered feed string or JSON null. Restore accepts a decoded
dictionary or JSON text up to 64 KiB. It rejects unknown/missing keys, nonboolean
flags, duplicate/unknown IDs, mismatched registry sizes, invalid references, and
freed registered nodes before any mutation. Current registrations must already
exist; restore never creates scene nodes or loads object paths.
This native schema is distinct from WebXR's `gamesystems.cameras.v1`; snapshots
from that extension are not accepted directly.

```gdscript
var saved_json := JSON.stringify(cameras.checkpoint())
var prepared := cameras.prepare_restore(saved_json)
if prepared.ok:
    var restored: bool = prepared.commit.call()
```

Prepared plans copy validated flags/references. Their one-shot commit rejects
topology changes, including removal and re-registration under the same ID, and
rechecks that host nodes are alive. A successful commit cancels pending captures,
invalidates old images and blanks monitors until their feeds render again. Poses,
optics, aspect, scene/world objects, quality, host visibility and GPU images are
not saved. Coordinate restore with other gameplay systems at the host boundary.

The same node optionally implements the `GSHost` lifecycle with ID `gs_cameras`
and tiers `minimal`, `low`, `mid`, `high`:

```gdscript
var cameras = host.load_extension(Cameras, {"screen_layer": 20})
```

The host's quality takes precedence over a `quality` option, and host integration
turns `auto_update` off to prevent duplicate time advancement. `switch_feed`
emits `screen_changed(state)` and, when hosted, `cameras:screen` on the host bus.
There is no required electricity, thermal, WebXR or other addon dependency.
Power adapters can call the enable methods. To keep cameras updating during a
gameplay pause, arrange the owner/host's process mode and time source accordingly.

This bounds capture resolution and cadence, not arbitrary scene rendering cost.
GPU correctness and target-headset performance require a rendered host scene;
headless contract tests alone do not establish either.

Run the native contract suite from the GameSystems repository. The headless command
checks the API and scheduling contracts; its dummy renderer skips pixel assertions.
Run the same script without `--headless` on a graphics-enabled machine to render a
camera environment color into a real `SubViewport`, read its texture image, and check
the center pixel:

```powershell
godot --headless --xr-mode off --path godot --script res://addons/gs_cameras/tests/gs_camera_system_tests.gd
godot --xr-mode off --path godot --script res://addons/gs_cameras/tests/gs_camera_system_tests.gd
```

The graphics check verifies that one requested draw reaches the borrowed feed texture
and that its center pixel matches a flat camera environment color. It does not verify
lit geometry, scene-specific culling/materials, the monitor's appearance in the main
viewport, XR compositor behavior, headset performance, or target-device GPU cost.
