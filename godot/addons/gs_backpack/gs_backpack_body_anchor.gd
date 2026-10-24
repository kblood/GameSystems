class_name GSBackpackBodyAnchorProvider
extends RefCounted
## P3: where the wearer's body is, as far as the backpack layer cares. A tiny interface so the worn pack, the hip/chest/back mounts and the
## detach logic never depend on a concrete avatar. Nightfall implements it with its existing solved holster-gear transform
## (operator_body.get_gear_anchor); an IKVR / VRIK joint provider (hips, chest and head joints) subclasses this later and overrides the same
## six methods. This base class is an inert "no body" provider; gs_backpack_body_anchor_static.gd is a settable one for tests and desktop.
##
## Frame convention (the pack's own): +X right, +Y up, -Z in front of the wearer (+Z behind). A hand "local" position is a world point
## taken through pack_frame().affine_inverse().
##
## Mount kinds understood by mount_frame(): "pack" (the worn-bag frame, also the frame hip/back mount groups hang off), "hip" (hips),
## "chest". A provider may support more; an unknown kind returns the pack frame.

## False while there is no usable body pose (avatar not built, tracking invalid). Callers keep their last pose then.
func is_valid() -> bool: return false

## Where the worn pack sits (the frame the bag returns to).
func pack_frame() -> Transform3D: return Transform3D.IDENTITY

## Frame of a body mount kind (see above).
func mount_frame(kind: String) -> Transform3D:
	return pack_frame()

## World height of the shoulders; the over-the-shoulder reach zone starts around here.
func shoulder_height() -> float: return 1.35

## World position of the head (summon zone, don distance fall back to it).
func head_position() -> Vector3: return Vector3(0.0, 1.65, 0.0)

## "standing" | "crouch" | "seated" (the state machine's postures).
func posture() -> String: return "standing"

## "right" | "left": the wearer's dominant hand.
func handedness() -> String: return "right"
