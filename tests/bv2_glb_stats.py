"""Per-node triangle / material / draw-call stats for bottle GLBs (pure python, no Blender).

python tests/bv2_glb_stats.py export/bottle_wine.glb export/v2/*.glb [--json out.json]
Draw calls = number of mesh primitives (one per material per mesh), what engines submit per object.
"""
import json, struct, sys, glob, os


def read_glb(path):
    with open(path, "rb") as f:
        data = f.read()
    magic, ver, length = struct.unpack_from("<4sII", data, 0)
    assert magic == b"glTF"
    off = 12
    js, binc = None, None
    while off < length:
        clen, ctype = struct.unpack_from("<I4s", data, off)
        chunk = data[off + 8: off + 8 + clen]
        if ctype == b"JSON":
            js = json.loads(chunk)
        elif ctype == b"BIN\x00":
            binc = chunk
        off += 8 + clen
    return js, binc


def stats(path):
    js, _ = read_glb(path)
    nodes = {}
    tot_tris = 0
    tot_prims = 0
    mats = set()
    for n in js.get("nodes", []):
        if "mesh" not in n:
            continue
        m = js["meshes"][n["mesh"]]
        tris = 0
        for p in m["primitives"]:
            if "indices" in p:
                tris += js["accessors"][p["indices"]]["count"] // 3
            else:
                tris += js["accessors"][p["attributes"]["POSITION"]]["count"] // 3
            if "material" in p:
                mats.add(p["material"])
        nodes[n["name"]] = dict(tris=tris, prims=len(m["primitives"]))
        tot_tris += tris
        tot_prims += len(m["primitives"])
    exts = sorted(js.get("extensionsUsed", []))
    imgs = len(js.get("images", []))
    return dict(file=os.path.basename(path), tris=tot_tris, draw_calls=tot_prims, materials=len(mats),
                textures=imgs, nodes=nodes, extensions=exts, kb=round(os.path.getsize(path) / 1024, 1))


if __name__ == "__main__":
    args = sys.argv[1:]
    out = None
    if "--json" in args:
        i = args.index("--json"); out = args[i + 1]; del args[i:i + 2]
    files = []
    for a in args:
        files += sorted(glob.glob(a))
    res = [stats(f) for f in files]
    for r in res:
        nd = " ".join(f"{k}:{v['tris']}" for k, v in r["nodes"].items())
        print(f"{r['file']:38s} tris={r['tris']:6d} dc={r['draw_calls']} mats={r['materials']} tex={r['textures']} "
              f"{r['kb']:7.1f}kB  {nd}  {','.join(e.replace('KHR_materials_', '') for e in r['extensions'])}")
    if out:
        json.dump(res, open(out, "w"), indent=1)
