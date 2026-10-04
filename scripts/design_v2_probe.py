"""Probe: compare the v2 Glass mesh radius with profile.json r(z) (pure python + numpy). Used to place label slots clear of ribs/feet.
   python scripts/design_v2_probe.py <name> [z0 z1]"""
import sys, os, json, struct
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import design_glb as G
ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

def mesh_positions(path, node_name="Glass", normals=False):
    js, b = G.read_glb(path)
    node = next(n for n in js["nodes"] if n["name"] == node_name)
    out = []
    for p in js["meshes"][node["mesh"]]["primitives"]:
        a = js["accessors"][p["attributes"]["POSITION"]]; bv = js["bufferViews"][a["bufferView"]]
        off = bv.get("byteOffset", 0) + a.get("byteOffset", 0); stride = bv.get("byteStride", 12)
        arr = np.frombuffer(b, dtype=np.uint8, count=a["count"] * stride, offset=off).reshape(a["count"], stride)[:, :12].copy().view("<f4").reshape(-1, 3)
        if normals:
            a = js["accessors"][p["attributes"]["NORMAL"]]; bv = js["bufferViews"][a["bufferView"]]
            off = bv.get("byteOffset", 0) + a.get("byteOffset", 0); stride = bv.get("byteStride", 12)
            nr = np.frombuffer(b, dtype=np.uint8, count=a["count"] * stride, offset=off).reshape(a["count"], stride)[:, :12].copy().view("<f4").reshape(-1, 3)
            arr = np.concatenate([arr, nr], axis=1)
        out.append(arr)
    return np.concatenate(out)

def profile_r(prof, z):
    o = prof["outer"]; k = len(o) - 1
    while k > 0 and o[k - 1][1] <= o[k][1] + 1e-9: k -= 1
    pts = sorted(((zz, r) for r, zz in o[k:]))
    return np.interp(z, [p[0] for p in pts], [p[1] for p in pts])

if __name__ == "__main__":
    n = sys.argv[1]
    prof = json.load(open(os.path.join(ROOT, "export", "v2", "bottle_%s.profile.json" % n)))
    P = mesh_positions(os.path.join(ROOT, "export", "v2", "bottle_%s.glb" % n))
    x, y, z = P[:, 0], P[:, 2] * 0 + P[:, 1], P[:, 2]   # glTF: x, y(up), z(front)
    zz, rr, th = P[:, 1], np.hypot(P[:, 0], P[:, 2]), np.arctan2(P[:, 0], P[:, 2])
    z0, z1 = (float(sys.argv[2]), float(sys.argv[3])) if len(sys.argv) > 3 else (0, prof["z_top"])
    print(n, "label_zone", prof["label_zone"], "mesh y range %.4f..%.4f" % (zz.min(), zz.max()))
    for zb in np.linspace(z0, z1, int((z1-z0)/0.004)+1):
        m = (np.abs(zz - zb) < 0.0007) & (rr > 0.5 * profile_r(prof, zb))
        if not m.any(): continue
        rp = float(profile_r(prof, zb)); rmax = rr[m].max(); rmin = rr[m].min()
        print("z %.3f  profile r %.2f mm  mesh outer max %+.2f  min %+.2f mm" % (zb, rp * 1000, (rmax - rp) * 1000, (rmin - rp) * 1000))
