# python lutint_volume.py : volume below the plane (d from Godot BottleLiquid, tests/godot_lutint/poses.jsonl) vs requested fill
import json, struct, numpy as np, sys
R = 'C:/Tools/BlenderShared/'
def liquid_mesh(path):
    b = open(path, 'rb').read(); jl, _ = struct.unpack('<II', b[12:20]); j = json.loads(b[20:20 + jl]); bin_ = b[28 + jl:]
    for n in j['nodes']:
        if n.get('name', '').startswith('Liquid') and 'mesh' in n:
            pr = j['meshes'][n['mesh']]['primitives'][0]
            def acc(i):
                a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]; o = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
                ct = {5126: ('f', 4), 5123: ('H', 2), 5125: ('I', 4)}[a['componentType']]; nc = {'VEC3': 3, 'SCALAR': 1}[a['type']]
                return np.array(struct.unpack('<%d%s' % (a['count'] * nc, ct[0]), bin_[o:o + a['count'] * nc * ct[1]])).reshape(a['count'], nc)
            return acc(pr['attributes']['POSITION']).astype(float), acc(pr['indices']).reshape(-1, 3)
def vol_below(P, T, up, d):
    # divergence theorem on the clipped closed mesh, tetrahedra fanned from an apex q ON the plane: the cap polygon
    # then contributes exactly zero, so no cap loop / orientation bookkeeping is needed (the old cap-area sum took the
    # two cut points in list order, which flips the edge direction for some clip cases -> wrong cap area when tilted).
    q = up * d; h = P @ up - d; V = 0.0
    for t in T:
        v = P[t] - q; hh = h[t]; inside = hh <= 0
        if not inside.any(): continue
        pts = []
        for i in range(3):
            j = (i + 1) % 3
            if inside[i]: pts.append(v[i])
            if inside[i] != inside[j]: s = hh[i] / (hh[i] - hh[j]); pts.append(v[i] + s * (v[j] - v[i]))
        for k in range(1, len(pts) - 1):
            V += pts[0] @ np.cross(pts[k], pts[k + 1]) / 6
    return V
for line in open(R + 'tests/godot_lutint/poses.jsonl'):
    r = json.loads(line); a = r['asset']
    P, T = liquid_mesh(R + ('export/v2/' if a in ('bottle_bordeaux', 'bottle_pet2l') else 'export/') + a + '.glb')
    vt = np.einsum('ij,ij->i', P[T[:, 0]], np.cross(P[T[:, 1]], P[T[:, 2]])).sum() / 6   # signed: handles inverted winding
    for p in r['poses']:
        if p['spilled']: print(f"{a:20s} tilt {p['tilt']:3d} fill {p['fill']:.2f}  SPILLED (open container, level at rim)"); continue
        up = np.array(p['up']); v = vol_below(P, T, up / np.linalg.norm(up), p['d']) / vt
        print(f"{a:20s} tilt {p['tilt']:3d} fill {p['fill']:.2f}  volume below plane {v:.4f}  err {100*(v-p['fill']):+.2f}% of capacity")
