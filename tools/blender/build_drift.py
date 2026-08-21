"""
Build THE DRIFT and export it as a game-ready GLB.

Run inside Blender (5.2), or drive it through the Blender MCP server, which is
how it was originally authored:

    blender --background --python tools/blender/build_drift.py

The model is generated rather than sculpted on purpose. A script is diffable,
reviewable, and re-runnable at a different size or proportion; a .blend file
that someone once nudged into shape is none of those things. Every creature in
Marrow should have one of these.

Design notes (docs/WORLD.md 6):
  - From bats. Ceiling-dwelling, hunts by sound, effectively blind.
  - The EARS are the silhouette. It has no working eyes, so the organ that
    matters is the one that should read from across a dark drift. They are
    deliberately oversized -- 0.62 m on a 1.35 m animal -- and swept out from
    the skull so the bottom of the shape is a trident.
  - It hangs head-DOWN, which is why the whole thing is built along -Z with
    the hooks at the origin. The game hangs it from a ceiling point directly.
  - Hide is dark but NOT black: pure black reads as a hole in the render
    rather than an animal. It has to catch a headlamp edge.
"""

import math
import os

import bmesh
import bpy
from mathutils import Vector

OUT_DIR = r"C:\dev\ashfall\packages\client\public\models"
OUT_NAME = "drift.glb"


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.armatures):
        for b in list(block):
            if b.users == 0:
                block.remove(b)


def build_body():
    """Edge chain + Skin modifier: organic taper for very few verts."""
    mesh = bpy.data.meshes.new("DriftBody")
    obj = bpy.data.objects.new("Drift", mesh)
    bpy.context.collection.objects.link(obj)

    bm = bmesh.new()
    spine = [
        (Vector((0, 0, 0.00)), 0.055),      # feet / hook
        (Vector((0, 0.02, -0.18)), 0.10),
        (Vector((0, 0.05, -0.45)), 0.17),   # chest
        (Vector((0, 0.04, -0.72)), 0.15),
        (Vector((0, -0.01, -0.98)), 0.10),  # neck
        (Vector((0, -0.06, -1.14)), 0.09),  # skull
        (Vector((0, -0.16, -1.24)), 0.04),  # snout
    ]
    verts = [bm.verts.new(p) for p, _ in spine]
    for a, b in zip(verts, verts[1:]):
        bm.edges.new((a, b))
    bm.to_mesh(mesh)
    bm.free()

    obj.modifiers.new("Skin", "SKIN")
    mesh.skin_vertices[0].data[0].use_root = True
    for i, (_, r) in enumerate(spine):
        mesh.skin_vertices[0].data[i].radius = (r, r)

    sub = obj.modifiers.new("Sub", "SUBSURF")
    sub.levels = sub.render_levels = 2
    return obj


def build_ears():
    """The silhouette. Springs from the SKULL, flares out and down.

    First attempt put these on the neck sweeping down the torso and they
    vanished against the body -- the animal read as a seed pod.
    """
    for side in (-1, 1):
        bpy.ops.mesh.primitive_cone_add(
            vertices=12, radius1=0.10, radius2=0.006, depth=0.62,
            location=(side * 0.09, -0.02, -1.30),
        )
        ear = bpy.context.object
        ear.name = f"Ear_{'L' if side < 0 else 'R'}"
        ear.rotation_euler = (math.radians(-152), math.radians(side * 34), 0)
        ear.scale = (1.0, 0.30, 1.0)  # membrane, not horn
        bpy.ops.object.shade_smooth()

        # tragus: the inner spike that makes a bat ear read as a bat ear
        bpy.ops.mesh.primitive_cone_add(
            vertices=6, radius1=0.026, radius2=0.002, depth=0.20,
            location=(side * 0.062, -0.05, -1.20),
        )
        t = bpy.context.object
        t.name = f"Tragus_{'L' if side < 0 else 'R'}"
        t.rotation_euler = (math.radians(-160), math.radians(side * 14), 0)


def build_claws():
    for side in (-1, 1):
        bpy.ops.mesh.primitive_torus_add(
            major_radius=0.045, minor_radius=0.012,
            major_segments=10, minor_segments=6,
            location=(side * 0.035, 0, 0.03),
        )
        c = bpy.context.object
        c.name = f"Claw_{'L' if side < 0 else 'R'}"
        c.rotation_euler = (math.radians(90), 0, 0)


def build_wings():
    """Folded, not spread. A hanging bat wraps itself."""
    for side in (-1, 1):
        me = bpy.data.meshes.new(f"WingMesh_{side}")
        ob = bpy.data.objects.new(f"Wing_{'L' if side < 0 else 'R'}", me)
        bpy.context.collection.objects.link(ob)
        bm = bmesh.new()

        shoulder = Vector((side * 0.10, 0.06, -0.40))
        elbow = Vector((side * 0.20, 0.10, -0.62))
        fingers = [
            Vector((side * 0.15, 0.13, -1.02)),
            Vector((side * 0.24, 0.09, -0.95)),
            Vector((side * 0.29, 0.03, -0.80)),
        ]

        cache = {}

        def v(p):
            key = tuple(round(c, 4) for c in p)
            if key not in cache:
                cache[key] = bm.verts.new(p)
            return cache[key]

        for a, b in zip(fingers, fingers[1:]):
            bm.faces.new((v(elbow), v(a), v(b)))
        bm.faces.new((v(shoulder), v(elbow), v(fingers[0])))
        bm.faces.new((v(shoulder), v(fingers[0]), v(Vector((side * 0.06, 0.10, -1.05)))))

        bm.to_mesh(me)
        bm.free()

        sol = ob.modifiers.new("Solidify", "SOLIDIFY")
        sol.thickness, sol.offset = 0.018, 0
        ob.modifiers.new("Sub", "SUBSURF").levels = 1

        # finger bones so the membrane reads as stretched over structure
        for tip, rad in zip(fingers, (0.012, 0.011, 0.010)):
            mid = (elbow + tip) / 2
            d = tip - elbow
            bpy.ops.mesh.primitive_cylinder_add(
                vertices=6, radius=rad, depth=d.length, location=mid
            )
            b = bpy.context.object
            b.rotation_mode = "QUATERNION"
            b.rotation_quaternion = d.to_track_quat("Z", "Y")


def finish_and_export():
    bpy.ops.object.select_all(action="DESELECT")
    for o in [o for o in bpy.data.objects if o.type == "MESH"]:
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
        for m in list(o.modifiers):
            try:
                bpy.ops.object.modifier_apply(modifier=m.name)
            except Exception as exc:  # a failed modifier must not kill the build
                print("skip", o.name, m.name, exc)

    drift = bpy.data.objects["Drift"]
    bpy.context.view_layer.objects.active = drift
    bpy.ops.object.join()
    drift.name, drift.data.name = "Drift", "DriftMesh"

    # origin at the hooks, so the game hangs it from a ceiling point directly
    bpy.context.scene.cursor.location = (0, 0, 0)
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")

    mat = bpy.data.materials.new("DriftHide")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.055, 0.045, 0.042, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.82
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.28
    drift.data.materials.clear()
    drift.data.materials.append(mat)
    bpy.ops.object.shade_smooth()

    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, OUT_NAME)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,  # Three.js is Y-up, Blender is Z-up
    )
    print(f"exported {path}  {os.path.getsize(path)} bytes  "
          f"{len(drift.data.vertices)} verts  {len(drift.data.polygons)} faces")


if __name__ == "__main__":
    clear_scene()
    build_body()
    build_ears()
    build_claws()
    build_wings()
    finish_and_export()
