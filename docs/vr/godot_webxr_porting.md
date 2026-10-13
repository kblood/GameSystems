# Porting between Godot OpenXR, Godot WebXR export and browser WebXR

The workspace has a native Godot/OpenXR project and a separate browser-JavaScript /
Three.js WebXR project; a Godot WebXR export is a planned target described here. These
targets do not share the same runtime or input implementation. Treat Godot/Steam Frame,
a Godot WebXR export and the standalone Three.js WebXR project as distinct targets with
an explicit shared behavior contract. The
[Godot port plan](../godot_port_plan.md) and project `AGENTS.md` define the current
boundary: browser JavaScript is reference material, not a native runtime dependency.
Port behavior and data formats; do not import a sibling project's runtime implementation
to avoid designing the native contract.

Check language compatibility before planning a direct port: Godot 4.x projects written
in C# currently cannot be exported to Web. A Web target therefore needs a GDScript/Web-
compatible implementation or a separate browser runtime; keep shared behavior and data
contracts independent of the scripting language. See Godot's
[Web export limitations](https://docs.godotengine.org/en/4.7/tutorials/export/exporting_for_web.html).

Godot provides a `WebXRInterface` only in Web exports. Godot 4.7 Web exports use WebGL 2
with the Compatibility renderer; Forward+ and Mobile are not supported on Web. See
[Godot's WebXR interface](https://docs.godotengine.org/en/4.7/classes/class_webxrinterface.html)
and [Web export renderer requirements](https://docs.godotengine.org/en/4.7/tutorials/export/exporting_for_web.html).
The browser exposes WebXR only in a secure context: deploy over HTTPS, with localhost
available for local development. Starting an immersive session also requires a recent user
gesture, so call `initialize()` directly from an explicit “Enter VR” button handler rather
than from startup or a later timer/callback. See the [WebXR security and activation rules](https://www.w3.org/TR/webxr/).

Godot's WebXR lifecycle is asynchronous. Connect `session_supported`, `session_started`,
`session_ended` and `session_failed` before requesting support or initializing. Check
`is_session_supported("immersive-vr")` through its `session_supported` signal; configure
`session_mode`, reference spaces and required/optional features before `initialize()`. A
true return from `initialize()` only means the request could be made: wait for
`session_started` before setting `get_viewport().use_xr = true`, show a useful fallback on
`session_failed`, and set `use_xr = false` on `session_ended`. Test browser exit and failed
feature negotiation as normal lifecycle paths. After `session_started`, record
`enabled_features` and `reference_space_type` where available so device acceptance logs
show what the browser actually negotiated, not only what the project requested. The
feature list may be empty on browsers without introspection support, so pair logging with
feature-specific behavior tests and a graceful fallback. Godot Web exports that enable
thread support or GDExtensions require cross-origin isolation. Godot 4.7 supports this through COOP/COEP
response headers or its documented PWA service-worker workaround; basic WebXR alone does
not require it. See the Web export guide's [thread and extension support](https://docs.godotengine.org/en/4.7/tutorials/export/exporting_for_web.html#thread-and-extension-support)
and [serving the files](https://docs.godotengine.org/en/4.7/tutorials/export/exporting_for_web.html#serving-the-files) sections.

Also connect `reference_space_reset` and `visibility_state_changed`. A reference-space
reset means the browser or device changed/reconfigured the tracking origin; it may happen
after recentering or a play-area change, and the runtime is not required to emit it for
every such change. Treat the first pose after a reset as a new tracking epoch: invalidate
pose-derived velocities, throw/melee sweeps and stale input edges, then recalibrate the
tracking-to-world mapping from fresh valid poses. Apply that mapping to the avatar, both
hands and held-object attachment frames as one transaction. Preserve held-item ownership
and its grip-relative pose unless the interaction contract explicitly calls for release;
never compute a velocity or collision sweep across the discontinuity. Godot exposes the
reset signal without a transform argument, so the adapter must establish its continuity
policy from tracked poses rather than expecting a reset delta.

`visibility_state_changed` reports the current `visibility_state` (`hidden`, `visible` or
`visible-blurred`). On hidden or blurred states, suspend gameplay input and time-based
actions such as firing, charging, locomotion and melee windows; do not accumulate elapsed
time or input edges to replay when visibility returns. Do not infer a release from missing
samples. Preserve inventory and ownership invariants, but suspend, park, cancel or release
a held object according to its documented lost-tracking contract, especially if the hidden
state persists. On return to `visible`, refresh valid head/hand poses, clear
motion history, and require neutral input followed by a fresh press before resuming
gameplay. Whether a runtime emits each visibility transition varies, so treat this as a
capability to observe and test, not a guaranteed pause callback. Godot documents both
signals and the visibility states in the
[WebXRInterface API](https://docs.godotengine.org/en/4.7/classes/class_webxrinterface.html#signals).

Add a device acceptance pass that recenters while holding a prop and another that hides
and restores the session. Verify no visible pose jump, unintended held-item detachment,
phantom throw, melee hit, repeated shot or locomotion burst occurs. Also verify brief loss
retains the item when specified, while prolonged loss follows its documented release policy.
Record whether the browser/device
actually emitted each signal; a manual recenter that produces no reset signal is a
separate runtime limitation to handle with pose-discontinuity detection. See the
[avatar calibration contract](controls.md#avatar-scale-and-calibration).

Also switch between controller and optical hand input, and disconnect/reconnect a source
while trigger or grip is held. Confirm the handoff clears input edges and pose-derived
velocity history, waits for a fresh valid pose and neutral controls, and requires a new
press before firing, throwing, or striking. Apply the source-handoff rules in
[VR controls](controls.md#devices-and-input-sources).

Godot 4.7's OpenXR action map does not automatically provide the input path for a WebXR
export. Build a small WebXR adapter that feeds the same semantic actions as the OpenXR
adapter:

- Use `XRController3D.button_pressed` / `button_released` for controller-specific buttons
  when the source is an advanced controller (such as Touch or Index).
- Also connect `WebXRInterface.selectstart` / `selectend` and
  `squeezestart` / `squeezeend`. These primary-action signals can represent advanced
  controllers and less conventional sources, so they are useful fallbacks for gaze, screen
  or device input. Do not assume they expose every controller button or analog value.
- For each WebXR input source ID, query `get_input_source_tracker()` and
  `get_input_source_target_ray_mode()` and maintain an adapter-owned mapping from the
  currently active source to semantic actions. Rebuild it when sources appear, disappear
  or change; do not treat the runtime's source ID as a persistent hand identity.
- On source handoff, clear held edges and velocity history, require a neutral state, then
  require a fresh press before firing, throwing or striking. Test controller-to-hand,
  controller-to-gaze/screen where supported, disconnect/reconnect, and changing source IDs.

Verify the exact signals, source metadata and behavior on the Godot release and target
browser. Godot documents the distinction between controller button signals and WebXR's
`select` / `squeeze` signals in its [WebXRInterface input documentation](https://docs.godotengine.org/en/4.7/classes/class_webxrinterface.html#description).

## What can be shared

Good candidates are engine-neutral state machines, typed IDs, gameplay rules, validated
JSON schemas, interaction semantics, deterministic tests and documented coordinate/unit
conventions. Keep rendering, scene nodes, physics bodies, controller binding, XR session
lifecycle, hand tracking and browser permissions behind platform adapters.

Before porting, define parity as observable outcomes: for example, “a grabbed object
remains attached while tracked hand pose is valid, enters a short lost-tracking grace
state during brief occlusion, and releases if tracking does not recover before the
configured timeout,” not “both ports use the same class.” List intentional differences
in timing, physics, tracking features and available hardware.

## Boundary contract

For each shared system record:

- canonical units, handedness, forward axis and world/local spaces;
- stable IDs and serialized schema/version migration;
- input actions and semantic events, independent of button layout;
- lifecycle transitions and idempotent cleanup;
- who owns transforms and simulation results;
- supported and optional capabilities, including fallback behavior;
- tolerances for timing and physics differences.

Do not share a frame loop. Native Godot uses its engine frame/physics ticks and OpenXR
session. Godot WebXR goes through `WebXRInterface` and browser lifecycle callbacks; the
separate Three.js project owns its own WebXR session and browser animation frame loop.
Translate elapsed time and poses at each adapter boundary. Do not assume identical
controller poses, action bindings, hand-joint availability, haptics, eye tracking,
filesystem access or background behavior. See the
[Godot 4.7 XR action map](https://docs.godotengine.org/en/4.7/tutorials/xr/xr_action_map.html).

Treat browser audio and persistence as explicit port boundaries. Godot's default Web
Audio Sample playback path does not support the full native audio feature set, including
AudioEffects (such as reverb), Doppler tracking and procedural audio generation; verify
the selected playback mode and target browsers before porting those features. Browsers
may also block audio until the user performs a gesture; unlock or start audio from an
explicit user action such as the Enter VR button, then verify playback on target browsers.
Web `user://` storage is backed by browser storage and may not persist in private browsing
or when cookies/site data are blocked. Embedded deployments can also face third-party
cookie restrictions that prevent persistent storage. Check `OS.is_userfs_persistent()`
as a diagnostic, but do not treat it as proof that a save will survive: validate save and
reload in the actual browser and embedding configuration. Provide a clear save failure or
retry path for important progress. See
[Godot's Web export audio and persistence notes](https://docs.godotengine.org/en/4.7/tutorials/export/exporting_for_web.html).

## Port sequence

1. Read both project contracts and the source system's current tests.
2. Extract the behavior and schema, then add engine-independent examples or fixtures.
3. Implement a target-platform adapter using that engine/runtime's lifecycle and input model.
4. Port tests around state transitions, loss/reacquisition and boundary conditions.
5. Add parity tests for shared outcomes; keep platform-specific integration tests local.
6. Test each build on its actual runtime/device and record deviations.
7. Sync generated copies only through the owning repository's established sync tool.

Never edit generated project copies as if they were canonical source. If one project
needs a local adaptation, document it in that project's adapter and provenance record.
When behavior intentionally differs, update the parity table and guide together.

## Common failure cases

The usual mistakes are copying coordinate transforms without checking axes, assuming
physics contacts are deterministic across engines, treating hand tracking as guaranteed,
using browser storage assumptions in a native game, tying UI logic to trigger names, and
claiming parity from matching unit tests while never running either headset build.
