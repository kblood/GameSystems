"""Accuracy test of liquid LUT v2: decode d for random orientations/fills, then integrate the volume below the plane
with an INDEPENDENT brute-force voxelisation (mesh rotated by a random rotation so the voxel columns run along another
axis, different cell size and jitter seed).  Also writes tests/out/containers_lut_cases.json for the JS/GDScript decoders.
Run: python tests/containers_lut_test.py [name ...]      (plain python + numpy, no Blender)
"""
import sys, os, json, glob
import numpy as np
ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import liquid_lut as L

OUT = os.path.join(ROOT, "tests", "out")
os.makedirs(OUT, exist_ok=True)


def rand_rot(rng):
    q = rng.normal(size=4); q /= np.linalg.norm(q)
    a, b, c, d = q
    return np.array([[a*a+b*b-c*c-d*d, 2*(b*c-a*d), 2*(b*d+a*c)], [2*(b*c+a*d), a*a-b*b+c*c-d*d, 2*(c*d-a*b)],
                     [2*(b*d-a*c), 2*(c*d+a*b), a*a-b*b-c*c+d*d]])


def targets(names):
    t = []
    for p in sorted(glob.glob(os.path.join(ROOT, "export", "container_*.glb"))):
        n = os.path.basename(p)[:-4]
        if n.endswith("_lod1"):
            continue
        t.append((n, p, os.path.join(ROOT, "export", n + ".liquid.json")))
    for p in sorted(glob.glob(os.path.join(ROOT, "export", "bottle_*.glb"))):
        n = os.path.basename(p)[:-4]
        if n.endswith(("_shards", "_broken")):
            continue
        sc = os.path.join(ROOT, "export", n + ".liquid_v2.json")
        if os.path.exists(sc):
            t.append((n, p, sc))
    return [x for x in t if not names or any(k in x[0] for k in names)]


def main(names):
    rng = np.random.default_rng(2024)
    report, cases = {}, {}
    worst_all = 0.0
    for n, glb, side in targets(names):
        V, F, ex = L.read_glb_node(glb, "Liquid")
        info = json.load(open(side))
        if "liquid" in ex and n.startswith("container"):          # extras embedded in the GLB must equal the sidecar
            emb = json.loads(ex["liquid"]) if isinstance(ex["liquid"], str) else ex["liquid"]
            assert emb["data"] == info["data"], "GLB extras differ from sidecar " + n
        lut = L.LutV2(info)
        R = rand_rot(rng)
        Vr = V @ R.T
        h = L.auto_h(V, 900000) * 0.7          # truth cell size (m), independent of the table's voxelisation
        pts, w, vi = L.voxelize(Vr, F, h, seed=99)
        extra = np.concatenate([L.AXIS_DIRS, L.grid_dirs(9).reshape(-1, 3)[::5]])
        # rotate the mesh by R: plane in the original frame with up u == plane in rotated frame with R u
        class Rot:                                                  # adapter evaluating the lut in the original frame
            def offset(self, u, f):                                 # d is invariant under the common rotation
                return lut.offset(u @ R, f)                         # u given in rotated frame -> original frame u0 = R^T u
        err = L.volume_error(Rot(), pts, w, 700, seed=5, extra_dirs=extra)
        pts_s, w_s, _ = L.voxelize(V, F, h, seed=3)
        err_up = L.volume_error(lut, pts_s, w_s, 200, seed=6, extra_dirs=extra)   # same-axis truth
        tiers = {}
        for tier in ("mid", "low"):
            tp = side.replace(".json", f".{tier}.json")
            if os.path.exists(tp):
                tl = L.LutV2(json.load(open(tp)))
                class RotT:
                    def offset(self, u, f, tl=tl):
                        return tl.offset(u @ R, f)
                te = L.volume_error(RotT(), pts, w, 500, seed=5, extra_dirs=extra)
                tiers[tier] = dict(max_pct=round(te["max_pct"], 2), rms_pct=round(te["rms_pct"], 3),
                                   json_kb=round(os.path.getsize(tp) / 1024, 1), n_dir=tl.n, n_fill=tl.F)
                print(f"    tier {tier:4s} {tl.n}x{tl.n}x{tl.F}: max {te['max_pct']:.2f}%  rms {te['rms_pct']:.2f}%  json {os.path.getsize(tp)/1024:.0f}KB")
        cap_err = (vi["volume"] / vi["mesh_volume"] - 1) * 100
        report[n] = dict(max_pct=round(err["max_pct"], 3), rms_pct=round(err["rms_pct"], 3), p99_pct=round(err["p99_pct"], 3),
                         same_axis_max_pct=round(err_up["max_pct"], 3), voxel_vs_mesh_vol_pct=round(cap_err, 2),
                         json_kb=round(os.path.getsize(side) / 1024, 1), worst=err["worst"], capacity_ml=info["capacity_ml"], tiers=tiers)
        worst_all = max(worst_all, err["max_pct"], err_up["max_pct"])
        print(f"{n:22s} max {err['max_pct']:.2f}%  p99 {err['p99_pct']:.2f}%  rms {err['rms_pct']:.2f}%  "
              f"(same-axis max {err_up['max_pct']:.2f}%)  json {os.path.getsize(side)/1024:.0f}KB  cap {info['capacity_ml']} ml")
        # cases for the other decoders
        cu = L.random_dirs(60, rng); cu = np.concatenate([L.AXIS_DIRS, cu])
        cf = rng.uniform(0, 1, len(cu)); cf[:6] = [0, 1, 0.5, 0.25, 0.9, 0.05]
        cd = lut.offset(cu, cf)
        cfill = lut.fill_at(cu, cd + rng.uniform(-0.003, 0.003, len(cu)))
        case = dict(file=os.path.relpath(side, ROOT).replace("\\", "/"), up=cu.tolist(), fill=cf.tolist(), d=cd.tolist(),
                    d_probe=(cd + 0.0).tolist(), fill_at_expected=cfill.tolist())
        # probe values for fill_at: use the same perturbed d as passed above
        rng2 = np.random.default_rng(7)
        pr = cd + rng2.uniform(-0.003, 0.003, len(cu))
        case["d_probe"] = pr.tolist()
        case["fill_at_expected"] = lut.fill_at(cu, pr).tolist()
        if info.get("rim_points"):
            sp = []
            rim = np.array(info["rim_points"])
            for u, f in zip(cu, cf):
                d = float(lut.offset(u, f)); dr = float((rim @ u).min())
                f2 = float(min(f, lut.fill_at(u, dr))) if d > dr else float(f)
                sp.append([bool(d > dr), f2])
            case["spill"] = sp
        cases[n] = case
    json.dump(report, open(os.path.join(OUT, "containers_lut_report.json"), "w"), indent=1)
    json.dump(cases, open(os.path.join(OUT, "containers_lut_cases.json"), "w"))
    print("WORST max volume error over all containers: %.2f%%" % worst_all)
    return worst_all


if __name__ == "__main__":
    w = main(sys.argv[1:])
    sys.exit(0 if w < 1.5 else 1)
