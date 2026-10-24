extends "res://addons/gs_backpack/gs_backpack_body_anchor.gd"
## Settable body provider: tests, desktop hosts and scenes without an avatar. Not a physics or IK object; set the fields, read the frames.

var valid := true
var pack := Transform3D.IDENTITY
var frames: Dictionary = {}
var shoulder_y := 1.35
var head := Vector3(0.0, 1.65, 0.0)
var posture_name := "standing"
var hand := "right"

func is_valid() -> bool: return valid and pack.is_finite() and absf(pack.basis.determinant()) > 0.001
func pack_frame() -> Transform3D: return pack
func mount_frame(kind: String) -> Transform3D: return frames.get(kind, pack)
func shoulder_height() -> float: return shoulder_y
func head_position() -> Vector3: return head
func posture() -> String: return posture_name
func handedness() -> String: return hand
