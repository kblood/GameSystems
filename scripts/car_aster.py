"""Build the original Aster 4-door sport sedan in Blender; no external assets required.

Run: C:\\tools\\Blender\\blender.exe -b --python scripts/car_aster.py -- [--no-render]
Source: src/vehicles/aster_sedan.blend. Runtime: export/vehicles/aster_sedan.glb.
Meters, Blender +Z up / -Y forward; glTF +Y up / +Z forward. All seven hinged
panels are parented to empties at physical hinges; the delivered model is closed.
"""
import bpy
import math
import json
import os
import sys
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, 'src', 'vehicles')
EXPORT = os.path.join(ROOT, 'export', 'vehicles')
RENDERS = os.path.join(ROOT, 'tests', 'out', 'vehicle')
for directory in (SOURCE, EXPORT, RENDERS):
    os.makedirs(directory, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for datablocks in (bpy.data.materials, bpy.data.meshes, bpy.data.curves):
    for item in list(datablocks):
        if not item.users:
            datablocks.remove(item)


def material(name, color, rough=.4, metal=0, transmission=0, coat=0, emission=0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    p.inputs['Transmission Weight'].default_value = transmission
    p.inputs['IOR'].default_value = 1.48
    p.inputs['Coat Weight'].default_value = coat
    p.inputs['Coat Roughness'].default_value = .13
    if emission:
        p.inputs['Emission Color'].default_value = (*color, 1)
        p.inputs['Emission Strength'].default_value = emission
    m.diffuse_color = (*color, 1)
    return m


paint = material('Paint_DeepPetrol_MetallicClearcoat', (.025, .155, .19), .24, .78, coat=1)
# Fine flake normal in the editable Blender source; glTF keeps the calibrated PBR coat.
p = paint.node_tree.nodes.get('Principled BSDF')
noise = paint.node_tree.nodes.new('ShaderNodeTexNoise')
noise.inputs['Scale'].default_value = 850
bump = paint.node_tree.nodes.new('ShaderNodeBump')
bump.inputs['Strength'].default_value = .08
bump.inputs['Distance'].default_value = .00006
paint.node_tree.links.new(noise.outputs['Fac'], bump.inputs['Height'])
paint.node_tree.links.new(bump.outputs['Normal'], p.inputs['Normal'])
glass = material('Glass_Laminated_Smoke', (.55, .70, .74), .07, .02, transmission=1, coat=.35)
rubber = material('Rubber_Tire', (.012, .016, .019), .69)
trim = material('Trim_SatinGraphite', (.022, .029, .034), .32, .28)
chrome = material('Metal_BrushedAluminum', (.55, .62, .66), .23, 1)
polished = material('Metal_MachinedRim', (.67, .73, .77), .16, 1)
steel = material('Metal_BrakeRotor', (.23, .27, .29), .36, .92)
leather = material('Leather_Saddle', (.32, .13, .062), .48)
leatherdark = material('Leather_Charcoal', (.029, .034, .039), .55)
carpet = material('Carpet_Anthracite', (.016, .020, .024), .93)
red = material('BrakeCaliper_OxideRed', (.48, .025, .018), .26, .42)
lamp = material('Lamp_LED_White', (.72, .88, 1), .18, .25, emission=3)
taillamp = material('Lamp_LED_Red', (.75, .009, .012), .19, .2, emission=2)
screen = material('Display_Glass', (.006, .025, .038), .12, .15, emission=.4)
screenline = material('Display_Cyan', (.10, .8, .95), .3, emission=1.5)
black = material('Cavity_Black', (.004, .006, .008), .78)
labelmat = material('Lettering_Silver', (.7, .75, .78), .3, .6)


def empty(name, loc=(0, 0, 0), parent=None):
    o = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(o)
    o.location = loc
    if parent:
        o.parent = parent
    return o


car = empty('Aster_Sedan')
car['asset_id'] = 'aster_sedan'
car['license'] = 'MIT - original procedural geometry'
car['vehicle_schema'] = 1


def parent_keep(o, parent=car):
    # Newly created empties/curves have stale matrix_world until the dependency graph evaluates.
    bpy.context.view_layer.update()
    matrix = o.matrix_world.copy()
    o.parent = parent
    o.matrix_world = matrix
    return o


def finish(o, name, mat, parent=car, bevel=0):
    o.name = name
    o.data.materials.append(mat)
    if bevel:
        m = o.modifiers.new('Soft manufacturing edges', 'BEVEL')
        m.width = bevel
        m.segments = 3
    if o.type == 'MESH':
        for face in o.data.polygons:
            face.use_smooth = True
        if bevel:
            m = o.modifiers.new('Weighted surface normals', 'WEIGHTED_NORMAL')
            m.keep_sharp = True
    parent_keep(o, parent)
    return o


def box(name, loc, size, mat, bevel=.01, parent=car, rotation=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.object
    o.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if rotation:
        o.rotation_euler = rotation
    return finish(o, name, mat, parent, bevel)


def mesh(name, vertices, faces, mat, parent=car, bevel=0):
    data = bpy.data.meshes.new(name + '_mesh')
    data.from_pydata(vertices, [], faces)
    data.update()
    o = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(o)
    return finish(o, name, mat, parent, bevel)


def tube(name, points, radius, mat, parent=car, cyclic=False):
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '3D'
    curve.resolution_u = 16
    curve.bevel_depth = radius
    curve.bevel_resolution = 3
    s = curve.splines.new('POLY')
    s.points.add(len(points)-1)
    for p, co in zip(s.points, points):
        p.co = (*co, 1)
    s.use_cyclic_u = cyclic
    o = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(o)
    o.data.materials.append(mat)
    return parent_keep(o, parent)


def cylinder(name, loc, radius, depth, mat, parent=car, vertices=48, axis='X'):
    rotation = (0, math.pi/2, 0) if axis == 'X' else (math.pi/2, 0, 0) if axis == 'Y' else (0, 0, 0)
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc, rotation=rotation)
    return finish(bpy.context.object, name, mat, parent, .002)


def torus(name, loc, major, minor, mat, parent=car, axis='X'):
    rot = (0, math.pi/2, 0) if axis == 'X' else (math.pi/2, 0, 0) if axis == 'Y' else (0, 0, 0)
    bpy.ops.mesh.primitive_torus_add(major_segments=64, minor_segments=12, location=loc, major_radius=major, minor_radius=minor, rotation=rot)
    return finish(bpy.context.object, name, mat, parent)


def beam(name, a, b, radius, mat, parent=car):
    return tube(name, [a, b], radius, mat, parent)


def text(name, word, loc, size, mat, rotation, parent=car):
    curve = bpy.data.curves.new(name, 'FONT')
    curve.body = word
    curve.align_x = 'CENTER'
    curve.size = size
    curve.extrude = .0003
    o = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = rotation
    o.data.materials.append(mat)
    parent_keep(o, parent)
    # Text must be mesh to survive glTF.
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.convert(target='MESH')
    o.select_set(False)
    return o


def side_x(z, y=0):
    return .924 - .17 * max(0, z - 1.02) / .48 - .035 * max(0, .62-z) / .2


def panel(name, outline, sign, mat=paint, parent=car, thickness=.035, bevel=.013):
    # Side outline in (longitudinal y, height z), modest tumblehome and shoulder.
    outer = [(sign * side_x(z, y), y, z) for y, z in outline]
    inner = [(x-sign*thickness, y, z) for x, y, z in outer]
    n = len(outer)
    faces = [tuple(range(n)), tuple(reversed(range(n, 2*n)))]
    faces += [(i, (i+1)%n, (i+1)%n+n, i+n) for i in range(n)]
    return mesh(name, outer+inner, faces, mat, parent, bevel)


def hood_surface(name, y0, y1, z0, z1, width0, width1, parent, crown=.06):
    vertices, faces = [], []
    ny, nx = 12, 18
    for j in range(ny+1):
        t=j/ny
        for i in range(nx+1):
            u=2*i/nx-1
            width = width0*(1-t)+width1*t
            z=z0*(1-t)+z1*t+crown*(1-u*u)*math.sin(.35+math.pi*.7*t)
            vertices.append((u*width, y0*(1-t)+y1*t, z))
    for j in range(ny):
        for i in range(nx):
            a=j*(nx+1)+i
            faces.append((a,a+1,a+nx+2,a+nx+1))
    o=mesh(name, vertices, faces, paint, parent)
    s=o.modifiers.new('Panel thickness', 'SOLIDIFY'); s.thickness=.025
    b=o.modifiers.new('Rolled edge', 'BEVEL'); b.width=.009; b.segments=3
    return o


def glazing(name, corners, parent=car):
    o=mesh(name, corners, [(0,1,2,3)], glass, parent)
    # Smoothing a solidified single quad bends its optical normals like a lens.
    for polygon in o.data.polygons: polygon.use_smooth=False
    s=o.modifiers.new('Laminated thickness', 'SOLIDIFY'); s.thickness=.004
    return o


# Floor, boxed sill sections, wheel tubs and a real empty passenger compartment.
box('Underbody', (0,.08,.32), (1.67,4.23,.16), trim, .08)
box('Cabin_Floor', (0,.13,.43), (1.66,2.29,.08), carpet, .025)
for sign in (-1,1):
    box('Rocker_Sill', (sign*.88,.11,.40), (.115,2.13,.14), paint, .035)
    box('Sill_MetalTread', (sign*.80,.12,.48), (.07,1.98,.018), chrome, .006)
    for y in (-1.43,1.39):
        points=[(sign*.875,y+math.cos(t)*.407,.35+math.sin(t)*.407) for t in [math.pi*k/40 for k in range(41)]]
        tube('WheelArch_Edge',points,.017,paint)
        # Visible dark inner wheel liner.
        tube('WheelArch_Liner',[(sign*.845,py,pz-.014) for _,py,pz in points],.026,rubber)

# Front/rear quarter panels with true wheel-arch cutouts.
for sign in (-1,1):
    for end, y0, y1, wheel in [('Front',-2.27,-.985,-1.43),('Rear',1.015,2.28,1.39)]:
        z0,z1=(.975,1.055) if end=='Front' else (1.045,.975)
        o=panel(end+'_Quarter_'+str(sign),[(y0,.4),(y1,.4),(y1,z1),(y0,z0)],sign,thickness=.11,bevel=.025)
        bpy.ops.mesh.primitive_cylinder_add(vertices=64,radius=.397,depth=2.8,location=(0,wheel,.35),rotation=(0,math.pi/2,0))
        cutter=bpy.context.object
        cut=o.modifiers.new('Wheel opening','BOOLEAN'); cut.operation='DIFFERENCE'; cut.object=cutter
        bpy.context.view_layer.objects.active=o
        bpy.ops.object.modifier_move_up(modifier=cut.name)
        bpy.ops.object.modifier_move_up(modifier=cut.name)
        bpy.ops.object.modifier_apply(modifier=cut.name)
        bpy.data.objects.remove(cutter,do_unlink=True)
        # Narrow horizontal shoulder joins side sheet metal to hood/deck lid.
        inner0,inner1=(.835,.866) if end=='Front' else (.865,.84)
        vertices=[(sign*inner0,y0,z0),(sign*.923,y0,z0),(sign*.921,y1,z1),(sign*inner1,y1,z1)]
        shoulder=mesh(end+'_FenderShoulder',vertices,[(0,1,2,3)],paint)
        solid=shoulder.modifiers.new('Shoulder thickness','SOLIDIFY'); solid.thickness=.022
        bevelmod=shoulder.modifiers.new('Shoulder rolled edge','BEVEL'); bevelmod.width=.009; bevelmod.segments=3

# Cabin structure: continuous roof and fixed A/B/C pillars, not an opaque cabin block.
hood_surface('Roof',-.47,.68,1.467,1.466,.739,.733,car,crown=.054)
for sign in (-1,1):
    beam('A_Pillar',(sign*.888,-.99,1.048),(sign*.739,-.48,1.475),.030,paint)
    beam('B_Pillar',(sign*.907,.133,1.045),(sign*.745,.133,1.485),.032,trim)
    beam('C_Pillar',(sign*.738,.69,1.466),(sign*.892,1.285,1.047),.055,paint)
    tube('Roof_DripRail',[(sign*.734,-.48,1.487),(sign*.751,.1,1.501),(sign*.73,.69,1.481)],.009,chrome)
    beam('Waist_Trim',(sign*.933,-.99,1.046),(sign*.933,1.24,1.046),.009,chrome)
wind=[(-.869,-.983,1.066),(.869,-.983,1.066),(.711,-.48,1.464),(-.711,-.48,1.464)]
glazing('Windshield',wind)
tube('Windshield_Seal',wind,.012,rubber,cyclic=True)
back=[(-.716,.692,1.456),(.716,.692,1.456),(.864,1.258,1.065),(-.864,1.258,1.065)]
glazing('Rear_Windshield',back)
tube('RearGlass_Seal',back,.011,rubber,cyclic=True)
for x in (-.40,.30):
    beam('Wiper_Arm',(x-.12,-1.003,1.078),(x+.15,-.90,1.151),.007,trim)
    beam('Wiper_Blade',(x-.05,-.927,1.132),(x+.35,-.887,1.164),.012,rubber)

hinges={}
for sign,label in [(-1,'L'),(1,'R')]:
    for front in (True,False):
        tag=('F' if front else 'R')+label
        key='door_'+tag.lower()
        ymin,ymax=(-.974,.104) if front else (.164,1.084)
        h=empty('Door_'+tag,(sign*.895,ymin,.89)); parent_keep(h,car)
        hinges[key]=(h,'Z',-sign*1.18)
        # Rear edge is clipped to the rear wheel opening.
        outline=[(ymin,.466),(ymax-.11,.466),(ymax,.73),(ymax,1.028),(ymin,1.028)] if not front else [(ymin,.466),(ymax,.466),(ymax,1.028),(ymin,1.028)]
        panel('DoorSkin_'+tag,outline,sign,parent=h,bevel=.018)
        # Clear frameless door glass follows tumblehome; black seal outlines actual separate panes.
        yz=[(ymin+.025,1.059),(ymax-.012,1.059),(ymax-.012,1.46),(-.486,1.452)] if front else [(ymin+.012,1.059),(1.17,1.059),(.673,1.445),(ymin+.012,1.46)]
        corners=[(sign*(side_x(z)-.006),y,z) for y,z in yz]
        glazing('DoorGlass_'+tag,corners,h)
        tube('DoorGlass_Seal_'+tag,corners,.009,trim,h,True)
        # Outer handle, painted cap, and visible handle recess.
        hy=ymax-.16
        box('Handle_Recess_'+tag,(sign*.94,hy,.91),(.012,.19,.041),trim,.017,h)
        box('Handle_'+tag,(sign*.958,hy-.008,.919),(.031,.155,.021),chrome,.008,h)
        # Interior card, leather armrest, aluminum latch and speaker grille.
        box('DoorCard_'+tag,(sign*.875,(ymin+ymax)/2,.752),(.061,ymax-ymin-.1,.37),leatherdark,.035,h)
        box('DoorInsert_'+tag,(sign*.836,(ymin+ymax)/2,.797),(.026,ymax-ymin-.19,.15),leather,.022,h)
        box('Armrest_'+tag,(sign*.803,(ymin+ymax)/2,.724),(.10,ymax-ymin-.24,.060),leather,.020,h)
        box('InteriorLatch_'+tag,(sign*.797,hy-.1,.875),(.022,.10,.018),chrome,.006,h)
        cylinder('DoorSpeaker_'+tag,(sign*.835,ymin+.15,.59),.072,.012,trim,h)
        for k in range(8):
            beam('SpeakerSlot',(sign*.822,ymin+.108+k*.012,.545),(sign*.822,ymin+.108+k*.012,.633),.0014,chrome,h)
        if front:
            beam('Mirror_Stalk_'+tag,(sign*.922,-.815,1.077),(sign*1.057,-.82,1.10),.026,trim,h)
            box('MirrorHousing_'+tag,(sign*1.08,-.80,1.113),(.20,.23,.108),paint,.045,h)
            box('MirrorGlass_'+tag,(sign*1.082,-.675,1.116),(.147,.010,.069),polished,.017,h)

# Hinged hood: pivot at the cowl; forward edge rotates upward.
hood=empty('Hood',(0,-.948,1.04)); parent_keep(hood,car)
hinges['hood']=(hood,'X',-1.10)
hood_surface('Hood_Panel',-2.18,-.968,.975,1.042,.845,.873,hood,.062)
for sign in (-1,1):
    tube('Hood_Crease',[(sign*.53,-2.13,1.024),(sign*.57,-1.59,1.084),(sign*.61,-.989,1.068)],.0035,paint,hood)
box('Hood_Liner',(0,-1.51,.955),(1.40,1.00,.025),carpet,.055,hood)
# Engine bay remains visible when hood opens.
box('EngineBay_Tub',(0,-1.54,.64),(1.59,1.14,.19),trim,.045)
for sign in (-1,1):
    box('EngineBay_Rail',(sign*.70,-1.51,.85),(.14,1.12,.25),paint,.03)
    cylinder('StrutMount',(sign*.68,-1.34,.99),.105,.024,chrome,axis='Z')
box('Engine_Block',(0,-1.55,.765),(.73,.58,.28),steel,.07)
box('Engine_Cover',(0,-1.55,.917),(.65,.50,.045),trim,.035)
for x in (-.23,-.115,0,.115,.23):
    box('Engine_Rib',(x,-1.55,.95),(.036,.38,.013),chrome,.006)
text('Engine_Logo','ASTER',(0,-1.50,.958),.09,labelmat,(0,0,math.pi))
box('Battery',( .53,-1.73,.838),(.26,.33,.20),trim,.018)
box('Battery_Positive',(.46,-1.87,.95),(.08,.065,.025),red,.006)
box('Battery_Negative',(.62,-1.87,.95),(.06,.065,.025),black,.006)
tube('Battery_Cable',[ (.46,-1.87,.96),(.4,-1.94,.94),(.27,-1.91,.90)],.012,red)
box('Airbox',(-.53,-1.76,.85),(.29,.31,.18),trim,.024)
tube('Intake_Hose',[(-.5,-1.62,.91),(-.43,-1.43,.93),(-.27,-1.42,.93)],.040,rubber)
box('Radiator',(0,-2.11,.73),(1.31,.095,.42),black,.015)
for x in [i*.058-.61 for i in range(22)]:
    box('Radiator_Fin',(x,-2.174,.74),(.010,.009,.35),steel,.001)

# Rear deck / genuine trunk cavity and hinged deck lid.
trunk=empty('Trunk',(0,1.274,1.045)); parent_keep(trunk,car)
hinges['trunk']=(trunk,'X',1.18)
hood_surface('Trunk_Deck',1.294,2.185,1.044,.966,.87,.85,trunk,.045)
box('Trunk_Underside',(0,1.71,.974),(1.44,.65,.032),carpet,.06,trunk)
box('Trunk_Floor',(0,1.71,.60),(1.43,.91,.07),carpet,.045)
for sign in (-1,1):
    box('Trunk_Liner',(sign*.735,1.71,.79),(.065,.92,.37),carpet,.018)
box('Trunk_BackWall',(0,1.285,.78),(1.46,.055,.39),carpet,.018)
box('Trunk_Lip',(0,2.176,.78),(1.56,.065,.25),trim,.02)
fuel=empty('FuelFlap',(.919,1.78,.904)); parent_keep(fuel,car)
hinges['fuel_flap']=(fuel,'Z',-1.40)
box('Fuel_Recess',(.927,1.875,.887),(.018,.217,.177),black,.037)
cylinder('Fuel_Cap',(.942,1.875,.889),.055,.018,trim)
box('Fuel_Flap_Panel',(.949,1.872,.904),(.022,.183,.153),paint,.028,fuel)

# Sculpted front/rear fascia, grilles, lamps and registration plates.
for front in (True,False):
    y=-2.245 if front else 2.245
    box(('Front' if front else 'Rear')+'_Bumper',(0,y,.655),(1.79,.215,.39),paint,.085)
    box('Lower_Diffuser',(0,y+(-.035 if front else .05),.434),(1.68,.18,.09),trim,.028)
    if front:
        box('Grille_Cavity',(0,-2.368,.692),(1.01,.025,.221),black,.050)
        for k in range(5):
            box('Grille_Slat',(0,-2.389,.606+k*.041),(.93,.018,.009),chrome,.003)
        for sign in (-1,1):
            box('BrakeDuct',(sign*.718,-2.354,.60),(.22,.025,.17),black,.03)
            for j in range(3):
                box('BrakeDuct_Vane',(sign*.718,-2.376,.55+j*.047),(.19,.014,.008),trim,.002)
            box('Headlight_Housing',(sign*.63,-2.242,.94),(.46,.114,.116),trim,.035)
            for j in (-1,1):
                cylinder('Projector_Lens',(sign*.63+j*.105,-2.309,.947),.034,.020,chrome,axis='Y')
                cylinder('Projector_LED',(sign*.63+j*.105,-2.322,.947),.024,.006,lamp,axis='Y')
            tube('DaytimeRunningLight',[(sign*.86,-2.307,.985),(sign*.43,-2.307,.985),(sign*.40,-2.296,.94)],.009,lamp)
    else:
        for sign in (-1,1):
            box('Taillight_Housing',(sign*.61,2.33,.934),(.52,.035,.115),trim,.032)
            for z in (.918,.951):
                box('Tail_Lightbar',(sign*.61,2.355,z),(.46,.014,.011),taillamp,.005)
            cylinder('Exhaust_Outer',(sign*.63,2.365,.45),.047,.13,chrome,axis='Y')
            cylinder('Exhaust_Inner',(sign*.63,2.436,.45),.036,.008,black,axis='Y')
    plate_y=-2.404 if front else 2.38
    box('RegistrationPlate',(0,plate_y,.64),(.46,.013,.102),leatherdark,.009)
    text('Registration_Text','ASTER  04',(0,plate_y+(-.009 if front else .009),.615),.055,labelmat,(math.pi/2 if front else math.pi/2,0,0 if front else math.pi))
text('Rear_Brand','A S T E R',(0,2.343,.88),.05,labelmat,(math.pi/2,0,math.pi))
text('Rear_Trim','2.0 T',(.73,2.306,1.019),.025,labelmat,(math.pi/2,0,math.pi))

# Wheels: modeled tires, grooves, split spokes, lug nuts, rotors and calipers.
for sign,label in [(-1,'L'),(1,'R')]:
    for front,y in [(True,-1.43),(False,1.39)]:
        tag=('F' if front else 'R')+label
        steer=empty('Steer_'+tag,(sign*.917,y,.35)); parent_keep(steer,car)
        wheel=empty('Wheel_'+tag,(sign*.917,y,.35)); parent_keep(wheel,steer)
        torus('Tire_'+tag,(sign*.917,y,.35),.267,.073,rubber,wheel)
        for offset in (-.035,0,.035):
            tread_radius=.267+math.sqrt(.073**2-offset**2)+.0003
            torus('Tread_Groove',(sign*.917+offset,y,.35),tread_radius,.0014,black,wheel)
        for k in range(48):
            a=2*math.pi*k/48
            for offset in (-.060,.060):
                tread_radius=.267+math.sqrt(.073**2-offset**2)+.0002
                o=box('Tread_Sipe',(sign*.917+offset,y+math.sin(a)*tread_radius,.35+math.cos(a)*tread_radius),(.015,.003,.002),black,.0006,wheel,(-a,0,.22 if offset>0 else -.22))
        torus('Rim_Lip_'+tag,(sign*1.001,y,.35),.244,.010,polished,wheel)
        torus('Rim_InnerLip_'+tag,(sign*.849,y,.35),.239,.012,chrome,wheel)
        cylinder('Rim_Barrel_'+tag,(sign*.93,y,.35),.238,.12,trim,wheel)
        cylinder('Brake_Disc_'+tag,(sign*.976,y,.35),.192,.015,steel,wheel)
        for k in range(18):
            a=math.tau*k/18
            cylinder('Rotor_Drill',(sign*.987,y+math.sin(a)*.165,.35+math.cos(a)*.165),.006,.003,black,wheel,vertices=8)
        for k in range(5):
            a=math.tau*k/5
            for delta in (-.11,.11):
                start=(sign*1.004,y+math.sin(a)*.060,.35+math.cos(a)*.060)
                end=(sign*1.005,y+math.sin(a+delta)*.229,.35+math.cos(a+delta)*.229)
                beam('Split_Spoke',start,end,.017,polished,wheel)
        cylinder('Wheel_Hub',(sign*1.015,y,.35),.065,.026,trim,wheel)
        cylinder('Wheel_Badge',(sign*1.031,y,.35),.027,.003,chrome,wheel)
        for k in range(5):
            a=math.tau*k/5
            cylinder('Lug_Nut',(sign*1.033,y+math.sin(a)*.047,.35+math.cos(a)*.047),.008,.011,chrome,wheel,vertices=6)
        box('Brake_Caliper_'+tag,(sign*.981,y-.153,.39),(.055,.075,.19),red,.018,steer)

# Cabin: four shaped seats, stitching, console, detailed dash and steering wheel.
for sign in (-1,1):
    for front in (True,False):
        y=-.15 if front else .76
        x=sign*.43
        box('Seat_Cushion',(x,y,.56),(.49,.49,.16),leather,.07)
        box('Seat_Center',(x,y-.01,.649),(.31,.37,.024),leatherdark,.027)
        box('Seat_Back',(x,y+.235,.90),(.48,.14,.52),leather,.065,rotation=(.10,0,0))
        box('Seat_Back_Insert',(x,y+.15,.90),(.31,.035,.39),leatherdark,.026,rotation=(.10,0,0))
        box('Headrest',(x,y+.25,1.227),(.29,.14,.17),leather,.045)
        for sx in (-.17,.17):
            tube('Seat_Stitch',[(x+sx,y-.18,.651),(x+sx,y+.13,.651)],.0017,labelmat)
        box('Seatbelt_Buckle',(x-sign*.27,y+.08,.66),(.039,.054,.082),trim,.008)
        box('Seatbelt_Release',(x-sign*.27,y+.08,.707),(.030,.038,.008),red,.003)
box('Rear_CenterCushion',(0,.76,.58),(.38,.48,.15),leather,.035)
box('Rear_CenterBack',(0,1.0,.91),(.38,.14,.46),leather,.045)
box('Center_Tunnel',(0,-.19,.58),(.25,1.13,.25),leatherdark,.04)
box('Console_Inlay',(0,-.28,.72),(.22,.61,.035),trim,.015)
for y in (.02,.18):
    cylinder('Cupholder',(0,y,.748),.065,.008,black,axis='Z')
    torus('Cupholder_Trim',(0,y,.751),.066,.003,chrome,axis='Z')
box('Gear_Selector',(0,-.43,.81),(.055,.08,.13),leatherdark,.022,rotation=(.18,0,0))
box('Gear_Selector_Trim',(0,-.43,.88),(.058,.07,.014),chrome,.006)
box('Console_Armrest',(0,.37,.79),(.24,.31,.08),leather,.033)
box('Dashboard',(0,-.79,.982),(1.61,.34,.19),leatherdark,.07)
box('Dashboard_Trim',(0,-.597,.95),(1.48,.023,.035),chrome,.010)
for x in (-.64,.51):
    box('Dash_Vent',(x,-.594,1.013),(.22,.025,.07),trim,.018)
    for k in range(4):
        box('Vent_Slat',(x,-.577,.994+k*.013),(.19,.01,.004),chrome,.001)
box('Center_Display_Frame',(.12,-.62,1.13),(.34,.045,.20),trim,.016,rotation=(-.12,0,0))
box('Center_Display',(.12,-.590,1.13),(.308,.008,.170),screen,.009,rotation=(-.12,0,0))
for k in range(4):
    box('Display_Row',(.15,-.582,1.10+k*.030),(.19-.025*k,.002,.004),screenline,.001)
text('Display_Logo','ASTER',(.05,-.575,1.17),.025,screenline,(math.pi/2,0,math.pi))
for x in (-.02,.20):
    cylinder('Climate_Knob',(x,-.569,.93),.024,.014,chrome,axis='Y')
box('Instrument_Hood',(-.43,-.66,1.11),(.42,.19,.16),leatherdark,.055)
box('Instrument_Display',(-.43,-.55,1.104),(.34,.01,.11),screen,.014)
for x in (-.52,-.34):
    torus('Gauge_Ring',(x,-.54,1.106),.040,.003,chrome,axis='Y')
    beam('Gauge_Needle',(x,-.535,1.106),(x-.02,-.535,1.13),.002,screenline)
beam('Steering_Column',(-.43,-.67,.90),(-.43,-.40,1.04),.043,trim)
torus('Steering_Wheel',(-.43,-.38,1.06),.157,.019,leatherdark,axis='Y')
for angle in (math.radians(95),math.radians(265),math.pi):
    beam('Steering_Spoke',(-.43,-.38,1.06),(-.43+math.sin(angle)*.14,-.38,1.06+math.cos(angle)*.14),.020,chrome)
box('Steering_Airbag',(-.43,-.355,1.06),(.13,.045,.105),leatherdark,.026)
for x in (-.55,-.38):
    box('Pedal',(x,-.76,.49),(.065,.06,.026),steel,.008,rotation=(.45,0,0))
box('RearView_Mirror',(0,-.67,1.375),(.22,.035,.070),trim,.016)
box('RearView_Glass',(0,-.645,1.375),(.197,.005,.052),polished,.012)
for sign in (-1,1):
    box('Sun_Visor',(sign*.41,-.46,1.436),(.32,.14,.022),leatherdark,.018)
    tube('Seatbelt',[(sign*.81,.16,1.30),(sign*.78,.19,.58),(sign*.70,.36,.48)],.012,leatherdark)

# Physical hinge metadata, useful to importers other than the Three.js binding.
parts={}
for key,(obj,axis,angle) in hinges.items():
    obj['vehicle_part']=key
    obj['hinge_axis_blender']=axis
    obj['open_angle_rad']=angle
    obj['closed_fraction']=0.0
    location=obj.matrix_world.translation
    parts[key]={'node':obj.name,'pivot':[location.x,location.z,-location.y],
                'axis':[0,1,0] if axis=='Z' else [1,0,0], 'openAngleRad':angle}
    # Two-key action exported as a named demonstration animation; runtime can set hinge directly.
    obj.rotation_mode='XYZ'
    component=2 if axis=='Z' else 0
    obj.rotation_euler[component]=0
    obj.keyframe_insert(data_path='rotation_euler',index=component,frame=1)
    obj.rotation_euler[component]=angle
    obj.keyframe_insert(data_path='rotation_euler',index=component,frame=31)
    obj.animation_data.action.name='Open_'+obj.name
    obj.rotation_euler[component]=0

scene=bpy.context.scene
scene.frame_set(1)
scene.render.engine='CYCLES'
scene.cycles.samples=48
scene.cycles.use_denoising=True
scene.render.resolution_x=1440
scene.render.resolution_y=960
scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.world.color=(.15,.15,.15)
scene.view_settings.view_transform='AgX'
scene.render.film_transparent=False

# Studio is separate and excluded from the exported model.
studio=bpy.data.collections.new('Studio_RenderOnly'); scene.collection.children.link(studio)
def studio_move(o):
    for c in list(o.users_collection): c.objects.unlink(o)
    studio.objects.link(o)
    return o
floor=box('Studio_Floor',(0,0,-.018),(200,200,.03),material('Studio_WarmGrey',(.14,.17,.19),.6),0)
floor.parent=None
studio_move(floor)
def light(name,loc,energy,size,color,scale=(1,1,1)):
    data=bpy.data.lights.new(name,'AREA'); data.energy=energy; data.shape='RECTANGLE'; data.size=size; data.size_y=size*.6; data.color=color
    o=bpy.data.objects.new(name,data); studio.objects.link(o); o.location=loc
    o.rotation_euler=(Vector((0,0,.7))-o.location).to_track_quat('-Z','Y').to_euler(); o.scale=scale
light('Key_Softbox',(-3,-4,6),1600,5,(.85,.94,1))
light('Side_Strip',(4,.5,3.7),1800,5,(1,.84,.70))
light('Rim_Strip',(-2,4,4.8),2300,4,(.7,.84,1))
light('Front_Fill',(0,-6,2.4),400,3,(1,1,1))
camera_data=bpy.data.cameras.new('Camera'); camera=bpy.data.objects.new('Camera',camera_data); studio.objects.link(camera); scene.camera=camera
def view(loc,target,lens=55):
    camera.location=loc; camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler(); camera.data.lens=lens
view((5.9,-7.7,3.8),(0,0,.75))

# Pack a self-contained editable source, then export only the vehicle hierarchy.
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(SOURCE,'aster_sedan.blend'))
# Collapse the runtime asset by material within each rigid part. The saved .blend
# above retains individual editable components and non-destructive modifiers.
groups={}
for obj in list(bpy.data.objects):
    if obj.parent and obj.type in ('MESH','CURVE') and obj.parent != floor:
        groups.setdefault(obj.parent,[]).append(obj)
for parent,objects in groups.items():
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects: obj.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]
    bpy.ops.object.convert(target='MESH')
    # One material per mesh = one runtime primitive/draw call.
    materials={}
    for obj in list(parent.children):
        if obj.type=='MESH': materials.setdefault(obj.data.materials[0].name,[]).append(obj)
    for name,objects in materials.items():
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects: obj.select_set(True)
        bpy.context.view_layer.objects.active=objects[0]
        if len(objects)>1: bpy.ops.object.join()
        bpy.context.object.name=parent.name+'__'+name
bpy.ops.object.select_all(action='DESELECT')
car.select_set(True)
def select_children(obj):
    for child in obj.children:
        child.select_set(True); select_children(child)
select_children(car)
bpy.context.view_layer.objects.active=car
bpy.ops.export_scene.gltf(filepath=os.path.join(EXPORT,'aster_sedan.glb'),export_format='GLB',use_selection=True,
    export_apply=True,export_extras=True,export_animations=True,export_cameras=False,export_lights=False,
    export_yup=True,export_materials='EXPORT',export_frame_range=False)
stats={'asset':'aster_sedan','schema':1,'dimensionsM':[2.28,1.56,4.82],'forward':[0,0,1],
       'up':[0,1,0],'wheelRadiusM':.34,'wheelbaseM':2.82,'parts':parts,
       'fuel':{'capacityL':52,'kind':'petrol'},'battery':{'capacityWh':720,'voltage':12.6},
       'source':'src/vehicles/aster_sedan.blend','model':'export/vehicles/aster_sedan.glb',
       'modelLow':'export/vehicles/aster_sedan_low.glb',
       'materialNotes':'Blender procedural microflake bump stays in source; GLB contains metallic/roughness, transmission and clearcoat PBR.',
       'license':'MIT - original geometry and materials generated by scripts/car_aster.py'}
with open(os.path.join(EXPORT,'aster_sedan.vehicle.json'),'w') as f: json.dump(stats,f,indent=2)
if '--no-render' not in sys.argv:
    scene.render.filepath=os.path.join(RENDERS,'aster_closed.png'); bpy.ops.render.render(write_still=True)
    scene.frame_set(31)
    view((5.9,-7.7,4.3),(0,0,.8))
    scene.render.filepath=os.path.join(RENDERS,'aster_open.png'); bpy.ops.render.render(write_still=True)
    view((-3.9,5.9,3.0),(0,.3,.8))
    scene.render.filepath=os.path.join(RENDERS,'aster_rear_open.png'); bpy.ops.render.render(write_still=True)
    scene.frame_set(1)
# Lower-triangle runtime version preserves materials, pivots and opening actions.
for obj in list(bpy.data.objects):
    if obj.parent and obj.type=='MESH' and len(obj.data.polygons)>200:
        decimate=obj.modifiers.new('Runtime low detail','DECIMATE'); decimate.ratio=.32
bpy.ops.object.select_all(action='DESELECT'); car.select_set(True); select_children(car)
bpy.context.view_layer.objects.active=car
bpy.ops.export_scene.gltf(filepath=os.path.join(EXPORT,'aster_sedan_low.glb'),export_format='GLB',use_selection=True,
    export_apply=True,export_extras=True,export_animations=True,export_cameras=False,export_lights=False,
    export_yup=True,export_materials='EXPORT',export_frame_range=False)
print('ASTER_BUILD_COMPLETE',json.dumps(stats))

