"""
Build a MARROW SURVIVOR — rigged, skinned, and exported for the game.

    blender --background --python tools/blender/build_survivor.py

Or drive it through the Blender MCP server, which is how it was authored.

WHY GENERATED AND NOT DOWNLOADED
--------------------------------
The obvious route is a Mixamo character. It is free but it needs an Adobe
account and a manual browser download, which means the character pipeline stops
being reproducible: nobody can rebuild the model from the repo. Generating it
keeps the whole project script-defined, the same way tools/foundry generates
every texture and build_drift.py generates the creature.

The cost is that it looks generated. That is an acceptable trade at 406 verts
seen from four metres away in sodium light, and it can be swapped for a
sculpted mesh later without touching a line of client code — the client only
ever looks up bones by name.

BONE NAMES ARE EXACT AND FLAT
-----------------------------
"hips", "chest", "head", "thigh.L" and so on. Not Mixamo's "mixamorigHead",
because substring lookups against that convention are a trap: `includes("Head")`
also matches `HeadTop_End`, so a headlamp mounted that way ends up on a
skull-cap bone instead of the skull. The client matches these exactly.

NO ANIMATION CLIPS ARE EXPORTED
-------------------------------
Gait is procedural, driven client-side from distance travelled (see
packages/client/src/humanoid.ts). That means no clip authoring, no retargeting,
and feet that cannot moonwalk at any speed.
"""

import math
import os

import bpy
from mathutils import Vector

OUT_DIR = r"C:\dev\ashfall\packages\client\public\models"
OUT_NAME = "survivor.glb"


def clear():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.armatures, bpy.data.actions):
        for b in list(block):
            if b.users == 0:
                block.remove(b)


def build_rig():
    bpy.ops.object.armature_add(enter_editmode=True, location=(0, 0, 0))
    arm = bpy.context.object
    arm.name = "SurvivorRig"
    arm.data.name = "SurvivorArmature"
    eb = arm.data.edit_bones
    eb.remove(eb[0])

    def bone(name, head, tail, parent=None, connect=False):
        b = eb.new(name)
        b.head = Vector(head)
        b.tail = Vector(tail)
        if parent:
            b.parent = eb[parent]
            b.use_connect = connect
        return b

    # 1.8 m. Spine chain up the centre.
    bone("hips", (0, 0, 0.98), (0, 0, 1.16))
    bone("spine", (0, 0, 1.16), (0, 0, 1.36), "hips", True)
    bone("chest", (0, 0, 1.36), (0, 0, 1.52), "spine", True)
    bone("neck", (0, 0, 1.52), (0, 0, 1.60), "chest", True)
    # The lamp mounts here. Tail points UP; the client offsets forward itself.
    bone("head", (0, 0, 1.60), (0, 0, 1.80), "neck", True)

    for side, x in (("L", 1), ("R", -1)):
        bone(f"shoulder.{side}", (0, 0, 1.48), (x * 0.17, 0, 1.46), "chest")
        bone(f"upperarm.{side}", (x * 0.17, 0, 1.46), (x * 0.20, 0, 1.16), f"shoulder.{side}", True)
        bone(f"forearm.{side}", (x * 0.20, 0, 1.16), (x * 0.21, 0, 0.90), f"upperarm.{side}", True)
        bone(f"hand.{side}", (x * 0.21, 0, 0.90), (x * 0.21, 0, 0.80), f"forearm.{side}", True)
        bone(f"thigh.{side}", (x * 0.10, 0, 0.96), (x * 0.11, 0, 0.54), "hips")
        bone(f"shin.{side}", (x * 0.11, 0, 0.54), (x * 0.11, 0, 0.10), f"thigh.{side}", True)
        bone(f"foot.{side}", (x * 0.11, 0, 0.10), (x * 0.11, -0.16, 0.03), f"shin.{side}", True)

    bpy.ops.object.mode_set(mode="OBJECT")
    return arm


def build_body():
    parts = []

    def cyl(name, r1, r2, depth, loc, rot=(0, 0, 0), verts=8):
        bpy.ops.mesh.primitive_cone_add(
            vertices=verts, radius1=r1, radius2=r2, depth=depth, location=loc, rotation=rot
        )
        o = bpy.context.object
        o.name = name
        parts.append(o)

    def box(name, loc, scale):
        bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
        o = bpy.context.object
        o.name = name
        o.scale = scale
        parts.append(o)

    # Torso tapers: narrow hips, broader chest. A straight tube reads as a barrel.
    cyl("pelvis", 0.17, 0.16, 0.22, (0, 0, 1.05), verts=10)
    cyl("torso", 0.16, 0.20, 0.34, (0, 0, 1.32), verts=10)
    cyl("upperchest", 0.20, 0.17, 0.14, (0, 0, 1.51), verts=10)

    # A HOOD, not a head. Stronger silhouette, and it hides the absence of a
    # face — which is exactly what a 400-vert budget wants.
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=0.115, location=(0, 0, 1.70))
    hood = bpy.context.object
    hood.name = "hood"
    hood.scale = (1.0, 1.12, 1.15)
    parts.append(hood)

    box("visor", (0, -0.10, 1.71), (0.075, 0.022, 0.045))
    # Filter cartridge — the single detail that says HAZMAT rather than person.
    cyl("filter", 0.045, 0.05, 0.07, (0, -0.115, 1.645), rot=(math.radians(90), 0, 0))
    cyl("tank", 0.075, 0.075, 0.30, (0, 0.155, 1.34), verts=10)
    cyl("tankcap", 0.045, 0.03, 0.05, (0, 0.155, 1.51))

    for side, x in (("L", 1), ("R", -1)):
        cyl(f"upperarm_{side}", 0.055, 0.048, 0.30, (x * 0.185, 0, 1.31))
        cyl(f"forearm_{side}", 0.048, 0.042, 0.26, (x * 0.205, 0, 1.03))
        box(f"hand_{side}", (x * 0.21, 0, 0.855), (0.05, 0.045, 0.055))
        cyl(f"thigh_{side}", 0.082, 0.07, 0.42, (x * 0.105, 0, 0.75))
        cyl(f"shin_{side}", 0.07, 0.055, 0.44, (x * 0.11, 0, 0.32))
        box(f"boot_{side}", (x * 0.11, -0.05, 0.055), (0.062, 0.11, 0.055))

    cyl("belt", 0.175, 0.175, 0.05, (0, 0, 1.00), verts=12)
    box("strap_l", (0.085, -0.01, 1.38), (0.028, 0.155, 0.008))
    box("strap_r", (-0.085, -0.01, 1.38), (0.028, 0.155, 0.008))

    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()

    body = bpy.context.object
    body.name = "Survivor"
    body.data.name = "SurvivorMesh"
    bpy.ops.object.shade_smooth()
    return body


def finish(rig, body):
    # Hazmat orange, muted and filthy. Bright safety orange fights the sodium
    # lighting; this reads as a suit worn for eleven years.
    mat = bpy.data.materials.new("SurvivorSuit")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.32, 0.16, 0.07, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.78
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.35
    body.data.materials.clear()
    body.data.materials.append(mat)

    # Automatic weights. Adequate for a low-poly figure, and it means the rig
    # can be regenerated from script without hand-painted weight maps.
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")

    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, OUT_NAME)

    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = rig

    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=False,  # keep the armature modifier as skinning
        export_skins=True,
        export_yup=True,  # Three.js is Y-up, Blender is Z-up
        export_animations=False,  # gait is procedural, client-side
    )
    print(f"exported {path}  {os.path.getsize(path)} bytes  "
          f"{len(body.data.vertices)} verts  {len(rig.data.bones)} bones")


if __name__ == "__main__":
    clear()
    rig = build_rig()
    body = build_body()
    finish(rig, body)
