# gs_grasp

The first G4 component is `GSNearestGrasp`, a standalone, stateless port of the
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
selector evidence. Merge/default policy, pose clamping, catalog/SDF, closure/contact,
bake algorithms, held-drive/throwing, avatar fitting and headset/in-game parity remain
outside this slice. No consumer repository has been synced by this change.
