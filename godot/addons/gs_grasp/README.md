# gs_grasp

The G4 components are `GSNearestGrasp`, `GSGraspMerge`, `GSGraspClamp`, `GSGraspShapeSdf`, `GSGraspVariants`, `GSGraspHeldDrive`, `GSGraspThrowRelease` and `GSGraspValidator`. The selector is a stateless port of the
public JavaScript `baked_grasps.nearestPose` scoring/selection operation. The caller
owns the candidate library and previous selection. This addon does not maintain a
global grasp library or integrate a native game's grab loop.

```gdscript
const Selector = preload("res://addons/gs_grasp/gs_nearest_grasp.gd")
const Baked = preload("res://addons/gs_grasp_data/gs_grasp_baked_data.gd")
var library := Baked.load_data() # Load and validate once, outside the update loop.
var result = Selector.nearest_pose(library.poses, "bottle_beer", "left",
    {"pos": [0.0, 0.02, 0.0], "quat": [0.0, 0.0, 0.0, 1.0]},
    {"previousId": null, "grasp": null, "filter": null})
if result != null:
    var selected_id: String = result.pose.id
```

`nearest_pose(poses: Array, kind: String, side: String, local: Dictionary,
options: Dictionary = {})` returns `null` or a Dictionary containing the original
`pose` Dictionary reference, `distance`, `angle` and `cost`. It neither copies nor
mutates poses. Minimum candidate fields are string `id`, `kind`, `side`, `grasp`,
three finite numeric `wrist` components and four finite numeric `quat` components.
Additional metadata is preserved without interpretation. Input order is retained;
duplicate IDs are allowed and each matching ID receives the previous-ID bonus.

Positions (`local.pos` and pose `wrist`) are in metres in the same item-local
coordinate frame. Orientations are `[x, y, z, w]` quaternions in that frame, with
the canonical hand frame's +Z along fingers and +Y dorsal. Caller code must perform
world/item or controller/hand-frame conversions before selection. Quaternions must
be unit length within squared-norm tolerance `0.001`, which accepts the rounded
canonical bake. The selector does not normalize them. The angle is
`2 * acos(min(1, abs(dot)))`, in radians; opposite quaternion signs are equivalent.
Scalar GDScript floats preserve double precision instead of going through Vector3.

The score is `distance + 0.05 * angle - previous_bonus` in metres. The bonus is
`0.01` metres when `pose.id == options.previousId`, so costs can be negative.
Hysteresis is a bonus over combined distance/rotation cost, not an independent
position threshold. A strict `<` comparison keeps the first candidate on an exact
score tie; near ties follow floating-point results without an epsilon. Decimal
values near a nominal 1 cm boundary need not produce bitwise-equal costs.

Options retain their JS names: `previousId` is null or a string; `grasp` is null,
an empty string (both disable that filter), or an exact grasp-name string. `filter`
is null or a valid Callable taking a pose and returning a boolean. It runs in
candidate order after matching kind/side and grasp. It must be synchronous and
side-effect-free: do not mutate the library or query from a callback. Callback
errors are programming errors, not caught failures. Unknown option keys are ignored.

The typed Godot API rejects wrong top-level argument types at the engine boundary.
Within those bounds, malformed query/library/options return `null`, including an
invalid pose outside the requested kind/side. The whole library is checked before
any predicate calls. Nonfinite computed scores also return `null`. This is an
intentional fail-closed divergence from JavaScript, which performs no validation
and can retain a first candidate with a NaN score. `null` therefore means either no
candidate or malformed input. `quat_angle(a: Array, b: Array)` is a low-level helper
with the same valid-quaternion preconditions; it does not perform validation itself.

The selector scans/validates caller input each call (linear time). No indexing or
device performance budget is claimed. A caller can supply just a relevant ordered
subset. Production use may add a separately validated/indexed library later.

## Verification and scope

`godot/tools/nearest_grasp_golden.mjs` invokes the real public JS selector using the
shipped bake and controlled synthetic candidates installed via `setGraspVariants`.
It restores variant selection afterwards. The generated golden includes source
dependency/probe hashes, constants, selected index/ID, score components and predicate
call order. It refers to the existing G3 bake instead of copying it into this addon.
Tests query all 255 baked wrists, 20 offset/sign-flipped cases and 21 synthetic cases:
empty/missing groups, grasp/predicate filters, ties/order, hysteresis, angle-distance
tradeoffs, quaternion sign/clamp and three-axis distance. Godot also tests malformed
inputs, original object identity and lack of mutation. Numeric tolerance is `1e-10`.

```powershell
node godot/tools/gen_golden.mjs --check
godot --headless --path godot --script res://addons/gs_grasp/tests/gs_nearest_grasp_tests.gd
```

Godot 4.7.2: **2,071 assertions passed, 296 parity cases**. This is source-only
selector evidence. Catalog/SDF, closure/contact, bake algorithms, held-drive/throwing,
avatar fitting and headset/in-game parity remain outside this slice.

## Clamping finger rows

`GSGraspClamp.clamp_rows(rows: Dictionary, data: Dictionary = {}) -> Variant` ports
the public JS `grasp_validator.clampRows`. It always returns a new Dictionary with
four degree values for every digit, and a fifth thumb twist only when the input thumb
row has one. Missing/short entries and non-finite values use the shared comfort
center; the thumb twist fallback is zero. Values are clamped to the shared hard joint
ranges. Extra non-thumb entries and entries beyond thumb twist are ignored. Input is
never mutated. A present row must be an Array; malformed rows or invalid validator
configuration return `null` (JS itself is more permissive for arbitrary object rows).
An empty `data` Dictionary is the default-data sentinel; pass a non-empty validated
`GSGraspValidatorData` payload to supply configuration explicitly.

The caller can preload validated `GSGraspValidatorData` and pass it to avoid reading
JSON on each call. This utility does not choose grasp quality, apply `CLAMP_EXEMPT`,
memoize results, close fingers to contact or alter the active game hand path.
`grasp_clamp.golden.json` is generated from the public JS function for all 255 baked
poses plus missing/partial rows and upper/lower extremes.

## Catalog signed distance

`GSGraspShapeSdf.signed_distance(shape, point)` ports catalog.js SDF for centered
boxes/cylinders, +Y lathes and flat unions (`parts`). Coordinates and results are
metres in item-local space; negative is inside. `surface_normal(shape, point, step)`
uses centered finite differences and defaults to a 0.1 mm step. Both validate the
shape and finite 3D point on each call and return `null` for malformed input. This
is approximate contact geometry: unions use `min`, not a smoothed blend, and lathes
use the existing slope-corrected radial silhouette. No grab-loop or physics integration
is included, and no device performance budget is claimed.

The SDF golden calls the public JS functions for deterministic points spanning every
catalog shape, including every component of union shapes and large finite coordinates.
Godot checks distance within `1e-10 m` and normals within `1e-7` per component.

## Selecting recorded variants

`GSGraspVariants.parse_selection(value)` and `select_variants(baked, recorded, value)`
port the public JS variant policy without a process-global active library. Null,
empty, `baked`, and `off` select the unchanged bake; `recorded` and `all` select every
recording; a comma-separated string or `Array[String]` selects matching IDs. An
explicit ID selection marks those recordings default before `GSGraspMerge` applies
the established default policy. Unknown IDs are returned in request order; selected
IDs and merged poses follow recording-file order. With no selected recordings,
`uses_baked` is true and `poses` is the caller's baked Array.

The result Dictionary contains `selection`, `poses`, `ids`, `unknown`, and
`uses_baked`. Neither source Array nor any input Dictionary is mutated. The typed
Godot boundary rejects non-string array members and non-string/non-array selection
values instead of applying JavaScript's general `String()` coercion. This utility
does not install global state in Nightfall's hand controller or implement a
recorded-only consumer mode.

The JS oracle covers 16 selections and restores the source module's previous variant
after generating fixtures. Godot 4.7.2 passes **9,347 assertions**; this verifies the
selection policy only, not a live runtime switch or recorded-only mode.

## Filtering recorded poses

`GSGraspRecordedPoses.is_pose(value)` and `recorded_poses(document)` port the JS
runtime's usable-pose filter. They validate required identity fields, side, finite
wrist/quaternion/row values, near-unit quaternion and optional hand length, then skip
invalid entries while preserving recording order. Unrelated optional metadata is
ignored, matching JS. This is deliberately less strict than the G3
`GSGraspRecordedData` source-file validator, which validates the complete document
and metadata before accepting it.

The JS golden covers missing/falsy/wrong schemas, malformed document shapes, valid
and invalid poses, quaternion tolerance edges, thumb twist rows and ignored metadata.
The utility only filters and does not merge, convert, score or install a runtime
library.

## Mirroring a recorded pose

`GSGraspMirror.mirror_pose(pose)` reflects wrist/palm Z over the item's XY plane,
switches the hand side, transforms the frame quaternion, and copies angle/open rows.
It preserves other metadata, records the source ID in `mirroredFrom`, and replaces
the first matching side token in a string ID before appending `-m`. Falsy `open`
values use the public JS default-open rows. It does not validate the pose or write it
to a library; callers must provide the fields used by `record.js`.

The JS golden covers left/right, a baked and recorded pose, default-open fallbacks,
empty-open behavior, first-token ID replacement, and input immutability. Godot 4.7.2
passes **978 assertions** across ten cases. This verifies conversion math and
copying only, not fit quality or runtime hand contact.

## Capture geometry helpers

`GSGraspCapture.hand_basis(side, joints)` derives the tracked hand frame from wrist,
index-knuckle, middle-knuckle and little-knuckle positions. It returns the forward,
radial, dorsal and thumb axes plus the basis quaternion, or `null` if a required
joint is missing or non-finite. `hand_length_from_joints(joints)` sums the wrist to
middle-fingertip bone chain, returning `null` when one of its joints is unusable.
`quat_from_basis(X, Y, Z)` converts matrix columns to an `[x,y,z,w]` quaternion.
`rows_from_joints(side, joints, hand)` extracts all five finger-angle rows, including
thumb twist. `capture_from_joints(side, joints, item, hand)` returns the wrist pose in
item space with those rows and the measured hand length, or `null` when required
tracking joints are missing. `recorded_pose(capture, options, catalog)` rounds and
normalizes a capture into a library-ready pose with default-open rows and recording
metadata; pass the prop catalog (or its `CATALOG` map) for the same default grip mode
as the JS API. The catalog argument is a Godot adapter parameter; JavaScript reads its
module catalog directly. A missing or null catalog grip defaults to `wrap`, matching
JavaScript's nullish fallback.
The Godot API accepts a Dictionary keyed by WebXR joint name; runtime adapters own
translation from their input container.

The JS golden covers both hand sides, missing/non-finite/degenerate joints, extreme
finite scales, zero length, all quaternion matrix branches, 12 baked-pose row captures,
two non-zero thumb-twist inversions, missing finger joints and six item-space capture
cases across rotated items. Godot 4.7.2 passes **711 assertions**. Closure/contact and
cases across rotated items, plus six recorded-pose cases for catalog defaults,
rounding, generated/explicit IDs, null grip fallback and optional metadata. It also
checks the runtime UTC stamp and reads the shared prop catalog. Godot 4.7.2 passes
**1,247 assertions**. Closure/contact and runtime integration remain separate work.

## Merging baked and recorded libraries

`GSGraspMerge.merge_poses(baked: Array, recorded: Array) -> Variant` ports the public
JS `record.mergePoses`. It returns an Array on valid input and does not mutate either
input. Use the returned library with `GSNearestGrasp` if desired; the merge utility
does not install global state or perform avatar conversion.

- Empty recordings return the exact original baked Array.
- Otherwise the output is a new Array: every baked entry remains in order, followed
  by surviving recordings in order. Duplicate IDs already in baked are retained.
  Recordings colliding with any baked ID are skipped; the first recorded ID wins.
- All recorded defaults are collected **before** duplicate filtering. Any such
  default clears every baked default in the same kind/side/grasp group, even when
  that recording is subsequently skipped. Clearing a default creates a shallow copy
  with `default = false`; all other baked Dictionaries retain their identity.
- Among surviving recordings, the first default per group normally remains default.
  Later defaults are shallow-copied with `default = false`; other recorded
  Dictionaries retain their identity. Missing `default` remains missing.
- Nested arrays/Dictionaries and metadata remain shared, including on shallow copies.

Two less obvious JS behaviors are intentionally preserved: grouping concatenates
`kind/side/grasp` strings, so embedded slashes can alias groups; the `seen` set shares
recording IDs with `default:<group>` markers, so an ID can collide with a marker.
That can skip a later recording or suppress its default. This port does not repair
those cases or introduce new ID/key restrictions.

Within the typed Array API, valid records are Dictionaries with string `id`, `kind`,
`side`, `grasp`, and optional boolean `default`. Empty strings are accepted. Geometry
and arbitrary additional metadata are untouched; this is not a pose/schema validator.
All entries are checked before merging. Invalid entries return `null`, including
invalid baked entries when recordings are empty. Wrong top-level types are rejected
by Godot's typed API. This differs deliberately from unchecked JS: JS's truthy/falsy
coercion, missing group fields, sparse arrays and non-string IDs are outside parity
scope. There are no units or coordinate conversions in this utility.

The public JS function generates 21 golden cases, including the canonical bake and
accepted recordings, duplicate/default conflicts, ordering, absent defaults and both
key-collision behaviors. Golden identity descriptors distinguish original versus
copied Dictionaries and record each nested reference. Godot checks output values,
array/record/nested identity and input preservation, plus malformed inputs. Fixture
generation checks JS inputs remain unchanged and hashes source/probe dependencies.

```powershell
node godot/tools/gen_golden.mjs --check
godot --headless --path godot --script res://addons/gs_grasp/tests/gs_grasp_merge_tests.gd
```

Godot 4.7.2: **2,392 assertions passed, 21 merge cases**. Sol-reviewed and synced to
Nightfall Godot. Variant parsing/selection, recording validation/conversion, native
`recorded-only` behavior, avatar fitting and live-game integration are not ported by
this utility. Existing native grasp logic is unchanged.

## Held-drive math and hand-motion samples

`GSGraspHeldDrive` ports the public JS `accelerationLimit`, `driveAcceleration`,
`driveAngular`, `createHandMotion`, `pushHandMotion` and `carriedVelocity` helpers.
Linear positions/velocities are metres and metres per second; mass is kilograms, `dt`
seconds and output acceleration metres per second squared. Angular error is an axis-angle
vector in radians, spin is radians per second, and output angular acceleration is radians
per second squared. `drive_acceleration` compensates the supplied gravity and clamps
acceleration by both `MAX_ACCELERATION` and the `MAX_HOLD_FORCE / mass` cap. Angular
acceleration is not torque-limited; `MAX_TORQUE` remains a host-physics responsibility.

Hand motion is explicit caller-owned state. `create_hand_motion()` creates a sample
window, and `push_hand_motion()` retains the last `HAND_MOTION_SAMPLES` valid samples
and updates a `dt`-weighted mean. `carried_velocity()` computes the point velocity
`linear + angular × (point - pivot)`. The default JSON tuning is loaded and cached on
first use; callers may instead supply a nonempty data Dictionary to avoid file access
(the utility validates supplied data on every call).
Invalid values fail closed (`null` for math results; an invalid sample leaves motion
unchanged). Use one sample state per hand/owner and update it at a stable sampling point.

The JS-generated golden covers four linear-drive cases, two angular cases, five mass
limits, a three-step weighted sample window and carried point velocity. Godot 4.7.2
passes **45 checks** with `2e-5` Vector3 tolerance. This utility computes math only:
it does not apply forces, integrate inertia, choose grasp targets or replace the
Nightfall physics-driven held-object loop. No headset performance budget or in-game
parity is claimed.

## Validating finger rows

`GSGraspValidator.validate_rows(rows)` ports the public JS `validateRows` diagnostic.
It checks every canonical finger row against the shared hard ranges (with the same
0.01-degree comparison tolerance), sums squared comfort-normalized distance, reports
hard failures, and emits warnings for thumb hyperextension, DIP/PIP coupling and
neighboring-finger pitch differences. The result has `ok`, `hard`, `warn` and `cost`
fields. Input/output row values are degrees; `cost` is dimensionless.

This does not clamp rows, reject a grasp in a runtime, select quality, solve contact
or mutate input. Missing, wrong-length, non-array or non-finite rows are reported as
`rule: "missing"`, matching the JS validator's fail result. Non-dictionary top-level
input therefore reports five missing fingers; malformed tuning returns `null`.
The default validated range/comfort contract is cached after first load; supplied
nonempty data is validated on each call. Non-finite accumulated cost fails closed.

The public-JS golden covers all 255 baked poses and nine focused cases for missing and
invalid rows, hard-bound tolerance, hyperextension, DIP/PIP coupling, neighbor pitch
with and without an intermediate row, and thumb twist. Godot 4.7.2 passes **4,789 checks** with `1e-9` relative numeric
tolerance. This verifies diagnostic parity only, not anatomy quality or runtime
acceptance.

## Throw release sampling

`GSGraspThrowRelease` ports the public JS constants and functions for creating a
throw history, adding controller velocity samples, calculating peak-smoothed release
velocity and deriving linear/angular velocity from consecutive poses. The release
selector evaluates short `RELEASE_SMOOTHING`-second time-weighted windows whose ends
fall inside `RELEASE_WINDOW`, then keeps the candidate with the greatest linear speed;
its angular sample stays paired with that candidate. Samples are individually bounded,
and history older than `HISTORY_SPAN` is discarded. Positions use world metres,
velocities metres/second, `dt` seconds and spin radians/second.

The typed API uses `Vector3` and unit `Quaternion` inputs and returns `null` for
malformed histories, non-finite input or invalid time steps; rejected pushes leave the
caller-owned history unchanged. `GLASS_BREAK_CONTACT_SPEED` is exported as tuning data;
the addon does not decide which contacts break glass, classify colliders, release
objects or apply physics. Nightfall retains its host adapter and interaction policy.
The JS-generated golden covers four release histories, six pushed samples including
history trimming/caps, three pose transitions (including noncommuting rotations and
negative-`w` sign equivalence) and invalid boundaries. Godot 4.7.2 passes **183 checks**
at `2e-5` Vector3 tolerance. It proves math parity only, not live
throw feel or headset performance.
