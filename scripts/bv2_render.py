"""Studio renders of bottle GLBs (old v1 or new v2) for design review.

blender -b --python scripts/bv2_render.py -- --out tests/out/bv2_x.png [--mode row|close|sil] [--fill 0.6]
        [--zc 0.30] [--dist 0.3] [--res 1600x700] [--samples 48] [--labels] file1.glb file2.glb ...

row   : all bottles side by side, upright, Cycles, softbox lighting, liquid cut at --fill (upright)
close : first bottle only, camera at --dist metres looking at height --zc (fraction of bottle height)
sil   : flat black silhouettes on white (Workbench), for the 128 px recognisability check
"""
import bpy, bmesh, sys, os, math, json
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
opt = dict(out="render.png", mode="row", fill="0.6", zc="0.8", dist="0.3", res="1600x700", samples="48",
           spin="0", elev="0", glassover="0")
files = []
i = 0
while i < len(argv):
    a = argv[i]
    if a.startswith("--"):
        opt[a[2:]] = argv[i + 1]; i += 2
    else:
        files.append(a); i += 1

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene


def cut_liquid(obj, fill):
    """Bisect the closed Liquid mesh at the height that holds `fill` of its volume (upright), fill the cap."""
    me = obj.data
    bm = bmesh.new(); bm.from_mesh(me)
    zs = [v.co.z for v in bm.verts]
    lo, hi = min(zs), max(zs)
    vol_total = bm.calc_volume()
    a, b = lo, hi
    for _ in range(30):
        m = 0.5 * (a + b)
        t = bm.copy()
        r = bmesh.ops.bisect_plane(t, geom=t.verts[:] + t.edges[:] + t.faces[:], plane_co=(0, 0, m), plane_no=(0, 0, 1),
                                   clear_outer=True)
        edges = [e for e in r["geom_cut"] if isinstance(e, bmesh.types.BMEdge)]
        if edges:
            bmesh.ops.holes_fill(t, edges=edges)
        v = abs(t.calc_volume()); t.free()
        if v < fill * abs(vol_total):
            a = m
        else:
            b = m
    m = 0.5 * (a + b)
    r = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, m), plane_no=(0, 0, 1),
                               clear_outer=True)
    edges = [e for e in r["geom_cut"] if isinstance(e, bmesh.types.BMEdge)]
    if edges:
        bmesh.ops.holes_fill(bm, edges=edges)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(me); bm.free()


def liquid_material(col):
    m = bpy.data.materials.new("LiquidR")
    nt = m.node_tree
    p = nt.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (1, 1, 1, 1)
    p.inputs["Transmission Weight"].default_value = 1.0
    p.inputs["Roughness"].default_value = 0.02
    p.inputs["IOR"].default_value = 1.34
    va = nt.nodes.new("ShaderNodeVolumeAbsorption")
    va.inputs["Color"].default_value = (col[0], col[1], col[2], 1)
    va.inputs["Density"].default_value = 40.0
    nt.links.new(va.outputs[0], nt.nodes["Material Output"].inputs["Volume"])
    return m


groups = []
for f in files:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(f))
    objs = [o for o in bpy.data.objects if o not in before]
    root = bpy.data.objects.new(os.path.basename(f), None); sc.collection.objects.link(root)
    for o in objs:
        if o.parent is None:
            o.parent = root
    groups.append((f, root, objs))

# liquid: cut at fill, use a transmissive material with the extras colour
fill = float(opt["fill"])
for f, root, objs in groups:
    for o in objs:
        if o.type != "MESH":
            continue
        if o.name.startswith("Liquid"):
            info = o.get("liquid")
            col = (0.5, 0.3, 0.1)
            if info:
                col = json.loads(info)["color"] if isinstance(info, str) else list(info["color"])
            if fill <= 0.001:
                o.hide_render = True
                continue
            if opt["mode"] != "sil":
                # apply the object's transform so z is the bottle axis
                mw = o.matrix_world.copy()
                o.data.transform(o.matrix_basis); o.matrix_basis.identity()
                cut_liquid(o, fill)
                o.data.materials.clear(); o.data.materials.append(liquid_material(col))
        if o.name.startswith("Label"):
            o.hide_render = opt["mode"] == "sil" and False

# bounds per group
def bounds(objs):
    mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
    for o in objs:
        if o.type != "MESH":
            continue
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            mn = Vector(map(min, mn, w)); mx = Vector(map(max, mx, w))
    return mn, mx

bpy.context.view_layer.update()
x = 0.0
H = 0.0
gap = 0.035
spin = math.radians(float(opt["spin"]))
for f, root, objs in groups:
    mn, mx = bounds(objs)
    w = mx.x - mn.x
    root.location.x = x + w / 2
    root.rotation_euler.z = spin
    x += w + gap
    H = max(H, mx.z - mn.z)
total_w = x - gap
bpy.context.view_layer.update()

# camera
cam_d = bpy.data.cameras.new("Cam"); cam = bpy.data.objects.new("Cam", cam_d); sc.collection.objects.link(cam)
sc.camera = cam
rx, ry = map(int, opt["res"].split("x"))
sc.render.resolution_x, sc.render.resolution_y = rx, ry
elev = math.radians(float(opt["elev"]))
if opt["mode"] in ("row", "sil"):
    cam_d.lens = 85
    aspect = rx / ry
    need_w = total_w * 1.08
    need_h = H * 1.12
    fov_x = 2 * math.atan(36 / 2 / 85)
    fov_y = 2 * math.atan(math.tan(fov_x / 2) / aspect)
    d = max(need_w / 2 / math.tan(fov_x / 2), need_h / 2 / math.tan(fov_y / 2))
    tgt = Vector((total_w / 2, 0, H / 2))
    cam.location = tgt + Vector((0, -d * math.cos(elev), d * math.sin(elev)))
else:
    f0, root0, objs0 = groups[0]
    mn, mx = bounds(objs0)
    cx = 0.5 * (mn.x + mx.x)
    zc = mn.z + float(opt["zc"]) * (mx.z - mn.z)
    tgt = Vector((cx, 0, zc))
    d = float(opt["dist"])
    cam_d.lens = 50
    cam.location = tgt + Vector((0, -d * math.cos(elev), d * math.sin(elev)))
dirv = tgt - cam.location
cam.rotation_euler = dirv.to_track_quat("-Z", "Y").to_euler()
cam_d.clip_start = 0.005

if opt["mode"] == "sil":
    sc.render.engine = "BLENDER_WORKBENCH"
    sh = sc.display.shading
    sh.light = "FLAT"; sh.color_type = "SINGLE"; sh.single_color = (0, 0, 0)
    sh.background_type = "VIEWPORT"; sh.background_color = (1, 1, 1)
    sc.view_settings.view_transform = "Standard"
    w = bpy.data.worlds.new("W"); sc.world = w; w.color = (1, 1, 1)
else:
    sc.render.engine = "CYCLES"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "OPTIX"
        prefs.get_devices()
        for dv in prefs.devices:
            dv.use = True
        sc.cycles.device = "GPU"
    except Exception as e:
        print("GPU fail", e)
    sc.cycles.samples = int(opt["samples"])
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 24; sc.cycles.transmission_bounces = 24; sc.cycles.transparent_max_bounces = 24
    sc.cycles.volume_bounces = 2
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Medium High Contrast"
    # world: dark studio gradient
    w = bpy.data.worlds.new("W"); sc.world = w
    nt = w.node_tree
    bg = nt.nodes["Background"]
    tc = nt.nodes.new("ShaderNodeTexCoord"); sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.35; ramp.color_ramp.elements[0].color = (0.02, 0.022, 0.026, 1)
    ramp.color_ramp.elements[1].position = 0.75; ramp.color_ramp.elements[1].color = (0.30, 0.31, 0.33, 1)
    mr = nt.nodes.new("ShaderNodeMapRange"); mr.inputs["From Min"].default_value = -1; mr.inputs["From Max"].default_value = 1
    nt.links.new(tc.outputs["Normal"], sep.inputs[0])
    nt.links.new(sep.outputs["Z"], mr.inputs["Value"]); nt.links.new(mr.outputs[0], ramp.inputs[0])
    nt.links.new(ramp.outputs[0], bg.inputs["Color"]); bg.inputs["Strength"].default_value = 1.0
    # floor (dark, slightly glossy)
    bpy.ops.mesh.primitive_plane_add(size=20, location=(total_w / 2, 0, -0.0005))
    fl = bpy.context.active_object
    fm = bpy.data.materials.new("Floor"); p = fm.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (0.05, 0.05, 0.055, 1); p.inputs["Roughness"].default_value = 0.35
    fl.data.materials.append(fm)
    # backdrop card behind (soft gradient lit by key)
    bpy.ops.mesh.primitive_plane_add(size=20, location=(total_w / 2, 3.0, 2), rotation=(math.radians(90), 0, 0))
    bd = bpy.context.active_object
    bm_ = bpy.data.materials.new("Back"); p = bm_.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (0.09, 0.095, 0.11, 1); p.inputs["Roughness"].default_value = 0.9
    bd.data.materials.append(bm_)

    def area(name, loc, size, energy, sx=None, color=(1, 1, 1)):
        ld = bpy.data.lights.new(name, "AREA"); ld.shape = "RECTANGLE"
        ld.size = size; ld.size_y = sx or size; ld.energy = energy; ld.color = color
        lo = bpy.data.objects.new(name, ld); sc.collection.objects.link(lo)
        lo.location = loc
        lo.rotation_euler = (Vector((total_w / 2, 0, H * 0.5)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        return lo
    s = max(1.0, total_w)
    # two tall strip lights left/right-back give the classic glass edge lines; soft key front-left; top
    area("StripL", (total_w / 2 - 0.9 * s, 0.5, H * 0.6), 0.25, 220 * s, sx=1.6, color=(1, 0.97, 0.93))
    area("StripR", (total_w / 2 + 0.9 * s, 0.5, H * 0.6), 0.25, 220 * s, sx=1.6, color=(0.93, 0.97, 1))
    area("Key", (total_w / 2 - 0.6 * s, -1.2 * s, 0.9), 1.2, 120 * s)
    area("Top", (total_w / 2, 0, 1.6), 1.5, 90 * s)
    area("Back", (total_w / 2, 2.5, H * 0.5), 2.5, 60 * s, sx=1.2)

sc.render.film_transparent = False
sc.render.image_settings.file_format = "PNG"
sc.render.filepath = os.path.abspath(opt["out"])
bpy.ops.render.render(write_still=True)
print("RENDERED", sc.render.filepath)
