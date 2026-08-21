/**
 * Procedural humanoid animation.
 *
 * NO ANIMATION CLIPS. Bones are driven directly from movement, which for a
 * low-poly figure at gameplay distance looks as good as a baked walk cycle and
 * buys three things a clip cannot:
 *
 *   - no Mixamo/Adobe dependency, so the whole character pipeline stays
 *     script-reproducible alongside tools/blender/build_survivor.py
 *   - stride length is a number we control, so feet CANNOT moonwalk
 *   - it is driven by the same authoritative velocity the netcode already
 *     sends, so remote players animate correctly for free
 *
 * PHASE COMES FROM DISTANCE, NOT TIME. This is the important one. The usual
 * approach scales an animation's playback rate by speed — `timeScale = v * k`
 * — which needs the clip's natural stride speed to be known and stays subtly
 * wrong at every other speed. Accumulating phase from metres travelled makes
 * foot-to-ground contact correct by construction at ANY speed, including
 * acceleration, and there is no magic constant to tune.
 */

import * as THREE from "three";

/** Metres of ground travel per full gait cycle (two steps). */
const STRIDE = 1.55;

export interface HumanoidBones {
  hips: THREE.Bone | null;
  spine: THREE.Bone | null;
  chest: THREE.Bone | null;
  head: THREE.Bone | null;
  thighL: THREE.Bone | null;
  thighR: THREE.Bone | null;
  shinL: THREE.Bone | null;
  shinR: THREE.Bone | null;
  upperarmL: THREE.Bone | null;
  upperarmR: THREE.Bone | null;
  forearmL: THREE.Bone | null;
  forearmR: THREE.Bone | null;
}

export class Humanoid {
  readonly root: THREE.Group;
  private bones: HumanoidBones;
  /** Rest pose, so every animation is a DELTA and never an absolute. */
  private rest = new Map<THREE.Bone, THREE.Quaternion>();
  private restHipsY = 0;

  /** Gait phase in radians, advanced by distance travelled. */
  private phase = 0;
  /** Smoothed speed, so a network hiccup does not snap the legs. */
  private speed = 0;
  private breath = Math.random() * Math.PI * 2;
  private prev = new THREE.Vector3();
  private first = true;

  constructor(source: THREE.Group) {
    this.root = SkeletonUtilsClone(source);

    const find = (name: string): THREE.Bone | null => {
      let found: THREE.Bone | null = null;
      this.root.traverse((o) => {
        // EXACT match. Substring matching is how a headlamp ends up parented
        // to a skull-cap bone: "Head" also matches "HeadTop_End".
        if ((o as THREE.Bone).isBone && o.name === name) found = o as THREE.Bone;
      });
      return found;
    };

    this.bones = {
      hips: find("hips"),
      spine: find("spine"),
      chest: find("chest"),
      head: find("head"),
      thighL: find("thigh.L"),
      thighR: find("thigh.R"),
      shinL: find("shin.L"),
      shinR: find("shin.R"),
      upperarmL: find("upperarm.L"),
      upperarmR: find("upperarm.R"),
      forearmL: find("forearm.L"),
      forearmR: find("forearm.R"),
    };

    for (const b of Object.values(this.bones)) {
      if (b) this.rest.set(b, b.quaternion.clone());
    }
    this.restHipsY = this.bones.hips?.position.y ?? 0;

    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        // Skinned meshes get culled by their REST bounding box, so a walking
        // figure vanishes when its rest pose leaves frame even though the
        // posed mesh is still visible. Cheaper to skip the test than to
        // recompute bounds every frame for a 406-vert model.
        o.frustumCulled = false;
      }
    });
  }

  /** Rotate a bone by an offset from its rest pose. */
  private pose(b: THREE.Bone | null, x: number, y = 0, z = 0): void {
    if (!b) return;
    const rest = this.rest.get(b);
    if (!rest) return;
    b.quaternion.copy(rest);
    b.rotateX(x);
    if (y) b.rotateY(y);
    if (z) b.rotateZ(z);
  }

  /**
   * @param pos    world position this frame
   * @param facing direction of travel, radians
   * @param dt     seconds
   */
  update(pos: THREE.Vector3, facing: number, dt: number): void {
    if (this.first) {
      this.prev.copy(pos);
      this.first = false;
    }

    const travelled = this.prev.distanceTo(pos);
    this.prev.copy(pos);

    const instant = dt > 0 ? travelled / dt : 0;
    // Smooth, frame-rate independent. Raw per-frame speed is far too noisy
    // when position arrives from interpolated snapshots.
    this.speed += (instant - this.speed) * (1 - Math.exp(-10 * dt));

    this.root.position.copy(pos);
    // Face the direction of travel, eased so turns are not instant snaps.
    const target = facing;
    let diff = target - this.root.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.root.rotation.y += diff * (1 - Math.exp(-9 * dt));

    // PHASE FROM DISTANCE. One full cycle per STRIDE metres, so the feet keep
    // up with the ground at any speed with no tuning constant.
    this.phase = (this.phase + (travelled / STRIDE) * Math.PI * 2) % (Math.PI * 2);
    this.breath = (this.breath + dt * 1.15) % (Math.PI * 2);

    // How much of the walk to apply. Below a threshold, blend to idle rather
    // than freezing mid-stride, which looks like a mannequin.
    const gait = Math.min(1, this.speed / 1.6);
    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);

    // --- legs: counter-phase swing -----------------------------------------
    this.pose(this.bones.thighL, s * 0.62 * gait);
    this.pose(this.bones.thighR, -s * 0.62 * gait);
    // Knees only bend one way. Rectifying the cosine keeps the shin from
    // hyperextending backwards, which is the classic procedural-walk tell.
    this.pose(this.bones.shinL, -Math.max(0, -c) * 0.95 * gait);
    this.pose(this.bones.shinR, -Math.max(0, c) * 0.95 * gait);

    // --- arms: counter-swing to the legs, plus a resting bend ---------------
    const armRest = 0.12;
    this.pose(this.bones.upperarmL, -s * 0.45 * gait - armRest);
    this.pose(this.bones.upperarmR, s * 0.45 * gait - armRest);
    this.pose(this.bones.forearmL, -0.25 - Math.max(0, s) * 0.3 * gait);
    this.pose(this.bones.forearmR, -0.25 - Math.max(0, -s) * 0.3 * gait);

    // --- torso: lean into movement, sway with the gait ----------------------
    this.pose(this.bones.spine, gait * 0.09, 0, c * 0.05 * gait);
    // Breathing lives in the chest and never stops. It is what keeps an idle
    // survivor from reading as a statue — and the headlamp inherits it.
    this.pose(this.bones.chest, Math.sin(this.breath) * 0.022 * (1 - gait * 0.6));
    // Head counter-rotates slightly, so it stays level as the torso sways.
    this.pose(this.bones.head, -gait * 0.05, -c * 0.04 * gait);

    // --- hips: two bobs per stride, plus lateral weight shift ---------------
    if (this.bones.hips) {
      this.bones.hips.position.y = this.restHipsY + Math.abs(s) * 0.035 * gait;
      this.pose(this.bones.hips, 0, 0, -c * 0.045 * gait);
    }
  }

  /**
   * Put a light where the head is, pointing where the head points.
   *
   * Mounted on the BONE rather than the camera on purpose: the beam then
   * inherits the breathing and the gait sway for free, which is most of what
   * makes a headlamp feel like it is strapped to a person rather than floating
   * in front of the lens.
   */
  aimHeadlamp(light: THREE.SpotLight, target: THREE.Object3D, forward = 0.16): void {
    const head = this.bones.head;
    if (!head) return;

    head.getWorldPosition(light.position);
    // The head bone points UP the skull (tail is above head), so "forward" is
    // the rig's -Z in head space, not the bone axis.
    const q = new THREE.Quaternion();
    head.getWorldQuaternion(q);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q).normalize();
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q).normalize();

    light.position.addScaledVector(fwd, forward).addScaledVector(up, 0.04);
    target.position.copy(light.position).addScaledVector(fwd, 12);
    target.updateMatrixWorld();
  }

  get currentSpeed(): number {
    return this.speed;
  }
}

/**
 * Clone a skinned hierarchy.
 *
 * THREE.Object3D.clone() does NOT rebind skeletons: every clone shares the
 * original's bone objects, so posing one survivor poses all sixty
 * simultaneously. This rebuilds the bone references per clone.
 */
function SkeletonUtilsClone(source: THREE.Object3D): THREE.Group {
  const clone = source.clone(true) as THREE.Group;

  const srcBones: THREE.Bone[] = [];
  const dstBones: THREE.Bone[] = [];
  source.traverse((o) => {
    if ((o as THREE.Bone).isBone) srcBones.push(o as THREE.Bone);
  });
  clone.traverse((o) => {
    if ((o as THREE.Bone).isBone) dstBones.push(o as THREE.Bone);
  });

  const map = new Map<THREE.Bone, THREE.Bone>();
  srcBones.forEach((b, i) => map.set(b, dstBones[i]));

  const srcMeshes: THREE.SkinnedMesh[] = [];
  const dstMeshes: THREE.SkinnedMesh[] = [];
  source.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) srcMeshes.push(o as THREE.SkinnedMesh);
  });
  clone.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) dstMeshes.push(o as THREE.SkinnedMesh);
  });

  srcMeshes.forEach((srcMesh, i) => {
    const dstMesh = dstMeshes[i];
    if (!dstMesh) return;
    const bones = srcMesh.skeleton.bones.map((b) => map.get(b) ?? b);
    dstMesh.bind(
      new THREE.Skeleton(bones, srcMesh.skeleton.boneInverses),
      dstMesh.matrixWorld
    );
  });

  return clone;
}
