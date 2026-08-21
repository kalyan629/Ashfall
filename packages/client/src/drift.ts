/**
 * The Drift.
 *
 * From bats. Ceiling-dwelling, hunts by sound, effectively blind.
 * Modelled in Blender via MCP and exported as a 53 KB GLB — see
 * tools/blender/build_drift.py for the script that generates it.
 *
 * The behaviour is the point, and it is deliberately tied to a mechanic the
 * player already has their hands on: **the ventilation hum masks you.** While
 * the handlers run, the drone covers your footsteps and the roost sleeps.
 * Cut the hum (H) and you become the loudest thing in the tunnel.
 *
 * So the player is handed a genuine dilemma rather than a jump scare. The hum
 * is also what keeps the lights up — and eventually, what keeps the air moving.
 *
 * NOTE: this is presentation-side only for now. A creature that can actually
 * hurt you has to live on the authoritative server, exactly like movement
 * does, or every client would see a different animal in a different place.
 * That is the next piece of work, and it is the reason this file is not
 * allowed to grow much further.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

type State = "roosting" | "stirring" | "hunting";

interface Drift {
  root: THREE.Group;
  home: THREE.Vector3;
  state: State;
  /** How awake it is, 0..1. Eases so waking reads as a stir, not a snap. */
  wake: number;
  seed: number;
  bob: number;
}

export class Roost {
  private drifts: Drift[] = [];
  private tmp = new THREE.Vector3();

  /** Nearest woken Drift, for the HUD to report. null when all are asleep. */
  alert: number | null = null;

  constructor(
    private scene: THREE.Scene,
    spots: [number, number, number][]
  ) {
    new GLTFLoader().load("/models/drift.glb", (gltf) => {
      const proto = gltf.scene;
      proto.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });

      for (const [x, y, z] of spots) {
        const root = proto.clone(true);
        root.position.set(x, y, z);
        // Vary size and facing so a roost does not read as copy-paste.
        const s = 0.85 + Math.random() * 0.4;
        root.scale.setScalar(s);
        root.rotation.y = Math.random() * Math.PI * 2;
        this.scene.add(root);
        this.drifts.push({
          root,
          home: new THREE.Vector3(x, y, z),
          state: "roosting",
          wake: 0,
          seed: Math.random() * 100,
          bob: Math.random() * 6,
        });
      }
    });
  }

  /**
   * @param player  where the player is
   * @param audible is the player making noise the roost can hear? The hum
   *                masks them, so this is true when the handlers are OFF.
   */
  update(dt: number, t: number, player: THREE.Vector3, audible: boolean): void {
    this.alert = null;
    let nearest = Infinity;

    for (const d of this.drifts) {
      const dist = this.tmp.copy(player).sub(d.home).length();

      // Hearing range. Generous, because sound carries absurdly well down a
      // stone tunnel and the player should feel the whole roost turn on them.
      const heard = audible && dist < 26;

      const want = heard ? 1 : 0;
      // Wake fast, settle slow. An animal that snaps back to sleep the instant
      // you restore power feels like a toggle; one that stays up feels alive.
      const rate = want > d.wake ? 2.4 : 0.35;
      d.wake += (want - d.wake) * (1 - Math.exp(-rate * dt));

      d.state = d.wake > 0.75 ? "hunting" : d.wake > 0.12 ? "stirring" : "roosting";

      // Roosting: almost still. A slow breath, nothing more.
      // Stirring: it unfolds and swings, and the ears track you.
      // Hunting: it drops off the ceiling and closes.
      d.bob += dt * (0.6 + d.wake * 7);
      const sway = Math.sin(d.bob + d.seed) * (0.02 + d.wake * 0.16);

      const drop = d.wake * 1.15; // comes down off the roof as it wakes
      d.root.position.set(
        d.home.x + sway,
        d.home.y - drop,
        d.home.z + Math.cos(d.bob * 0.7 + d.seed) * (d.wake * 0.12)
      );

      // Hanging things are head-down; as it wakes it rights itself to face
      // the player. Rotating rather than translating keeps it cheap.
      d.root.rotation.z = sway * 0.8;
      if (d.wake > 0.12) {
        const toPlayer = Math.atan2(player.x - d.root.position.x, player.z - d.root.position.z);
        // ease toward the player instead of snapping
        const cur = d.root.rotation.y;
        let diff = toPlayer - cur;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        d.root.rotation.y = cur + diff * (1 - Math.exp(-3 * dt)) * d.wake;
      }

      if (d.wake > 0.12 && dist < nearest) {
        nearest = dist;
        this.alert = dist;
      }
    }
  }

  get count(): number {
    return this.drifts.length;
  }
}
