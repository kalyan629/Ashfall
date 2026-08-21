/**
 * ASHFALL client — Level 2, The Commons.
 *
 * Every texture in this scene was generated on Kipchoge's four 1080 Tis by
 * tools/foundry. Nothing here is a stock asset.
 *
 * The art direction is one idea (docs/WORLD.md 8.1): warm sodium pools against
 * cold dark. Establishing it on day one costs nothing and it is the difference
 * between "a grey box with capsules in it" and somewhere that feels like a place.
 */

import * as THREE from "three";
import {
  COLLIDERS,
  DEEP_BOUNDARY_X,
  DRIFT_END_X,
  DRIFT_HALF_Z,
  DRIFT_HEIGHT,
  PLAYER_RADIUS,
  ROOM_HALF_X,
  ROOM_HALF_Z,
} from "@ashfall/shared";
import { Net } from "./net.js";
import { Hum } from "./audio.js";

const SODIUM = 0xffa23d;
const COLD = 0x0d1116;

const params = new URLSearchParams(location.search);
const name = params.get("name") ?? `survivor-${Math.floor(Math.random() * 900 + 100)}`;
const wsUrl = params.get("server") ?? `ws://${location.hostname}:8080`;

const net = new Net(wsUrl, name);
const hum = new Hum();

// --- renderer -------------------------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(COLD);
// Fog is doing real work here: it hides the far wall, implies the room
// continues, and is the cheapest depth cue in 3D.
scene.fog = new THREE.FogExp2(COLD, 0.020);

const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 200);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// ACES filmic keeps the bright sodium pools from blowing out to flat white
// and gives the falloff a filmic roll-off instead of a hard clip.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
document.body.appendChild(renderer.domElement);

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// --- textures -------------------------------------------------------------
const loader = new THREE.TextureLoader();

function tex(slug: string, repeat: number): THREE.Texture {
  const t = loader.load(`/tex/${slug}.webp`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

/** Reuse the albedo as a bump map.
 *
 *  Not a real normal map — a proper one needs a height pass the foundry does
 *  not generate yet (Phase 4 follow-up). But luminance correlates well enough
 *  with depth on these materials that it reads convincingly under a moving
 *  light, and it costs one extra sampler. */
function surface(slug: string, repeat: number, bump = 0.25): THREE.MeshStandardMaterial {
  const map = tex(slug, repeat);
  const bumpTex = tex(slug, repeat);
  return new THREE.MeshStandardMaterial({
    map,
    bumpMap: bumpTex,
    bumpScale: bump,
    roughness: 0.92,
    metalness: 0.05,
  });
}

// --- the room -------------------------------------------------------------
// The art direction is warm-against-cold, which needs BOTH. With only the
// sodium lamps lit, every surface went the same orange and the scene read as
// monochrome — the grey tread floor looked like orange brick. A dim cold fill
// gives the sodium something to be warm *against*, and keeps shadowed areas
// legible instead of pure black.
const hemi = new THREE.HemisphereLight(0x35506b, 0x140f0a, 0.8);
const ambient = new THREE.AmbientLight(0x16222e, 0.18);
scene.add(hemi, ambient);

/** Global fill in the lit levels vs. in the deep.
 *
 *  Dimming a *global* light by player position is legitimate here because each
 *  client renders only its own camera — this is a per-viewer effect, not a
 *  change to the world. Without it the drift would be lit exactly like the
 *  Commons and the headlamp would be decoration rather than a lifeline. */
const FILL_LIT = { hemi: 0.8, ambient: 0.18 };
const FILL_DEEP = { hemi: 0.055, ambient: 0.02 };

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(ROOM_HALF_X * 2, ROOM_HALF_Z * 2),
  surface("steel_plate", 5, 0.18)
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const ceiling = new THREE.Mesh(
  new THREE.PlaneGeometry(ROOM_HALF_X * 2, ROOM_HALF_Z * 2),
  surface("concrete_rebar", 8, 0.3)
);
ceiling.rotation.x = Math.PI / 2;
ceiling.position.y = 5;
scene.add(ceiling);

// --- the drift east, toward the deep ---------------------------------------
// Its own floor and ceiling because it is lower than the Commons. Stepping
// from a 5 m ceiling into a 2.6 m drift is the whole point: the building
// closes on you and nobody had to say so.
const driftFloor = new THREE.Mesh(
  new THREE.PlaneGeometry(DRIFT_END_X - ROOM_HALF_X, DRIFT_HALF_Z * 2),
  surface("mud_silt", 6, 0.3)
);
driftFloor.rotation.x = -Math.PI / 2;
driftFloor.position.set((ROOM_HALF_X + DRIFT_END_X) / 2, 0.002, 0);
driftFloor.receiveShadow = true;
scene.add(driftFloor);

const driftCeil = new THREE.Mesh(
  new THREE.PlaneGeometry(DRIFT_END_X - ROOM_HALF_X, DRIFT_HALF_Z * 2),
  surface("collapsed_timber", 6, 0.4)
);
driftCeil.rotation.x = Math.PI / 2;
driftCeil.position.set((ROOM_HALF_X + DRIFT_END_X) / 2, DRIFT_HEIGHT, 0);
scene.add(driftCeil);

const wallMat = surface("shotcrete", 7, 0.35);
const rockMat = surface("rock_face", 9, 0.5);
const pillarMat = surface("copper_pipe", 2, 0.3);
const benchMat = surface("rust_sheet", 2, 0.25);
const driftMat = surface("wet_limestone", 5, 0.55);
const timberMat = surface("brace_timber", 1, 0.4);

// Colliders are rendered straight from the shared definition, so what you see
// is exactly what you collide with. Art can never drift from physics.
for (const b of COLLIDERS) {
  // Kind and height are DECLARED on the collider, never guessed from its
  // dimensions — see the note on BoxKind in shared/world.ts.
  const deep = b.x > DEEP_BOUNDARY_X;
  const mat = deep
    ? b.kind === "pillar"
      ? timberMat // shoring, not copper pipe: nobody plumbed the drift
      : driftMat
    : b.kind === "pillar"
      ? pillarMat
      : b.kind === "bench"
        ? benchMat
        : b.hx > 10
          ? rockMat
          : wallMat;

  const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.hx * 2, b.h, b.hz * 2), mat);
  mesh.position.set(b.x, b.h / 2, b.z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
}

// --- sodium lamps ---------------------------------------------------------
interface Lamp {
  light: THREE.PointLight;
  bulb: THREE.Mesh;
  base: number;
  /** One lamp in every room is on its way out. That single detail says
   *  "maintained by tired people" better than any amount of grime. */
  dying: boolean;
  seed: number;
}

const lamps: Lamp[] = [];
// A 3x3 grid. Six lamps at distance 13 left most of a 40x28 room unlit — the
// spawn point had no lamp within 11 m and the whole scene went black.
const lampSpots: [number, number, boolean][] = [
  [-13, -9, false],
  [0, -9, false],
  [13, -9, false],
  [-13, 0, false],
  [0, 0, false],
  [13, 0, true], // this one is failing
  [-13, 9, false],
  [0, 9, false],
  [13, 9, false],
];

for (const [lx, lz, dying] of lampSpots) {
  const light = new THREE.PointLight(SODIUM, 34, 19, 2);
  light.position.set(lx, 4.4, lz);
  light.castShadow = true;
  light.shadow.mapSize.set(512, 512);
  light.shadow.bias = -0.005;
  scene.add(light);

  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 8, 8),
    new THREE.MeshBasicMaterial({ color: SODIUM })
  );
  bulb.position.copy(light.position);
  scene.add(bulb);

  // Cage above the bulb, so the light source reads as a fixture someone
  // installed rather than a floating orb.
  const cage = new THREE.Mesh(
    new THREE.CylinderGeometry(0.28, 0.34, 0.22, 8, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0x2a2622,
      roughness: 1,
      side: THREE.DoubleSide,
    })
  );
  cage.position.set(lx, 4.62, lz);
  scene.add(cage);

  lamps.push({ light, bulb, base: 34, dying, seed: Math.random() * 100 });
}

// --- dust -----------------------------------------------------------------
// Motes drifting in the light. Sells "air that has been recirculated for
// eleven years" and gives the volume something to hang depth on.
const DUST = 260;
const dustGeo = new THREE.BufferGeometry();
const dustPos = new Float32Array(DUST * 3);
const dustVel = new Float32Array(DUST);
for (let i = 0; i < DUST; i++) {
  dustPos[i * 3] = (Math.random() - 0.5) * ROOM_HALF_X * 2;
  dustPos[i * 3 + 1] = Math.random() * 5;
  dustPos[i * 3 + 2] = (Math.random() - 0.5) * ROOM_HALF_Z * 2;
  dustVel[i] = 0.04 + Math.random() * 0.09;
}
dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
const dust = new THREE.Points(
  dustGeo,
  new THREE.PointsMaterial({
    color: 0xffd9a0,
    size: 0.022,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
);
scene.add(dust);

// --- the headlamp ----------------------------------------------------------
/**
 * Light is a resource, not a setting (docs/WORLD.md 7.4).
 *
 * The lamp burns a finite charge, so every minute spent in the drift costs
 * something you cannot make down there. It is also deliberately narrow: a wide
 * comfortable flood would remove the entire tension of not being able to see
 * sideways. You get a cone, and the cone is where your attention is.
 *
 * Later this becomes a Drift problem too — light attracts things — but the
 * scarcity has to exist before the predator can mean anything.
 */
const LAMP_FULL = 240; // seconds of charge
let lampCharge = LAMP_FULL;
let lampOn = false;

const headlamp = new THREE.SpotLight(0xfff2d8, 0, 26, Math.PI / 7, 0.45, 1.6);
headlamp.castShadow = true;
headlamp.shadow.mapSize.set(1024, 1024);
headlamp.shadow.bias = -0.004;
scene.add(headlamp);
scene.add(headlamp.target);

/** Which way the player is facing. Movement direction, held through idle so
 *  the beam does not snap back to north every time you stop walking. */
const facing = new THREE.Vector2(0, -1);

// --- avatars --------------------------------------------------------------
const avatarGeo = new THREE.CapsuleGeometry(PLAYER_RADIUS, 1.0, 4, 12);

function makeNameTag(text: string): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.font = "600 28px ui-monospace, Menlo, monospace";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineWidth = 6;
  g.strokeStyle = "rgba(0,0,0,0.9)";
  g.strokeText(text, 128, 32);
  g.fillStyle = "#f2e0c0";
  g.fillText(text, 128, 32);
  const t = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true })
  );
  s.scale.set(2.2, 0.55, 1);
  return s;
}

interface Avatar {
  group: THREE.Group;
  body: THREE.Mesh;
  tag: THREE.Sprite;
  label: string;
  prev: THREE.Vector2;
  bob: number;
}

const avatars = new Map<string, Avatar>();

function avatarFor(id: string, label: string, isSelf: boolean): Avatar {
  const existing = avatars.get(id);
  if (existing) return existing;

  const group = new THREE.Group();
  const body = new THREE.Mesh(
    avatarGeo,
    new THREE.MeshStandardMaterial({
      color: isSelf ? 0xc8b89a : 0x7d8894,
      roughness: 0.75,
    })
  );
  body.position.y = 0.9;
  body.castShadow = true;
  group.add(body);

  const tag = makeNameTag(label);
  tag.position.y = 2.0;
  group.add(tag);

  scene.add(group);
  const a: Avatar = { group, body, tag, label, prev: new THREE.Vector2(), bob: 0 };
  avatars.set(id, a);
  return a;
}

// --- input ----------------------------------------------------------------
const held = new Set<string>();
addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  hum.start(); // WebAudio needs a gesture; the first keypress is it
  if (k === "h") hum.toggle();
  if (k === "f") lampOn = !lampOn;
  held.add(k);
});
addEventListener("keyup", (e) => held.delete(e.key.toLowerCase()));
addEventListener("blur", () => held.clear());

function intent(): { dx: number; dz: number } {
  let dx = 0;
  let dz = 0;
  if (held.has("w") || held.has("arrowup")) dz -= 1;
  if (held.has("s") || held.has("arrowdown")) dz += 1;
  if (held.has("a") || held.has("arrowleft")) dx -= 1;
  if (held.has("d") || held.has("arrowright")) dx += 1;
  const len = Math.hypot(dx, dz);
  if (len > 0) {
    dx /= len;
    dz /= len;
  }
  return { dx, dz };
}

// --- hud ------------------------------------------------------------------
const hud = document.getElementById("hud")!;
let roster: string[] = [];
net.onRoster = (n) => (roster = n);

// --- loop -----------------------------------------------------------------
let last = performance.now();
let walkPhase = 0;
const camPos = new THREE.Vector3(0, 8, 12);

function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  const t = now / 1000;

  const { dx, dz } = intent();
  net.sendInput(dx, dz, dt);

  const moving = dx !== 0 || dz !== 0;
  walkPhase += moving ? dt * 9 : 0;
  if (moving) facing.set(dx, dz);

  // --- headlamp ---
  // Drains only while lit. When it dies it stays dead — there is no recharge
  // in the drift, which is the point of going back for supplies.
  if (lampOn && lampCharge > 0) lampCharge = Math.max(0, lampCharge - dt);
  const lampLive = lampOn && lampCharge > 0;

  // The last 20 seconds browns out and flickers, so the player is warned
  // before they are blind rather than after.
  const dying = lampCharge < 20 ? 0.25 + Math.random() * 0.55 : 1;
  headlamp.intensity = lampLive ? 42 * dying : 0;
  headlamp.position.set(net.self.x, 1.55, net.self.z);
  headlamp.target.position.set(
    net.self.x + facing.x * 10,
    0.9,
    net.self.z + facing.y * 10
  );
  headlamp.target.updateMatrixWorld();

  const inDeep = net.self.x > DEEP_BOUNDARY_X;

  // Ease the fill between zones rather than snapping. Crossing the threshold
  // should feel like the light falling away behind you, which takes about a
  // second — a hard cut just reads as a bug.
  const wantFill = inDeep ? FILL_DEEP : FILL_LIT;
  const k = 1 - Math.exp(-1.8 * dt);
  hemi.intensity += (wantFill.hemi - hemi.intensity) * k;
  ambient.intensity += (wantFill.ambient - ambient.intensity) * k;
  // Air in the drift is wet and full of rock dust; the beam should die sooner.
  const wantFog = inDeep ? 0.085 : 0.02;
  (scene.fog as THREE.FogExp2).density +=
    (wantFog - (scene.fog as THREE.FogExp2).density) * k;

  // --- lamps ---
  // Only an alarm once the hum has actually existed. See Hum.started.
  const humOff = hum.started && !hum.running;
  for (const l of lamps) {
    let f = 1;
    if (l.dying) {
      // Irregular, not a clean sine — a failing sodium lamp stutters.
      const n = Math.sin(t * 13 + l.seed) * Math.sin(t * 7.3 + l.seed * 2);
      f = n > 0.1 ? 1 : 0.12 + Math.random() * 0.25;
    }
    // When the handlers cut, the lamps brown out with them.
    if (humOff) f *= 0.45 + Math.sin(t * 2 + l.seed) * 0.05;
    l.light.intensity = l.base * f;
    (l.bulb.material as THREE.MeshBasicMaterial).color.setHex(SODIUM);
    l.bulb.scale.setScalar(0.7 + f * 0.4);
  }

  // --- dust ---
  const dp = dustGeo.attributes.position.array as Float32Array;
  for (let i = 0; i < DUST; i++) {
    dp[i * 3 + 1] += dustVel[i] * dt;
    dp[i * 3] += Math.sin(t * 0.4 + i) * 0.002;
    if (dp[i * 3 + 1] > 5) {
      dp[i * 3 + 1] = 0;
      dp[i * 3] = (Math.random() - 0.5) * ROOM_HALF_X * 2;
      dp[i * 3 + 2] = (Math.random() - 0.5) * ROOM_HALF_Z * 2;
    }
  }
  dustGeo.attributes.position.needsUpdate = true;

  // --- self, from prediction (never from the stale snapshot) ---
  if (net.selfId) {
    const me = avatarFor(net.selfId, name, true);
    me.group.position.set(net.self.x, 0, net.self.z);
    // Head bob. Tiny — 4 cm. Big enough to feel, small enough not to nauseate.
    me.body.position.y = 0.9 + (moving ? Math.abs(Math.sin(walkPhase)) * 0.04 : 0);
    me.tag.position.y = 2.0;
  }

  // --- everyone else, interpolated 100 ms in the past ---
  const seen = new Set<string>();
  for (const p of net.interpolated()) {
    seen.add(p.id);
    if (p.id === net.selfId) continue;
    const a = avatarFor(p.id, p.name, false);
    a.group.position.set(p.x, 0, p.z);
    // Bob remote players by their own measured speed, so they walk too.
    const speed = a.prev.distanceTo(new THREE.Vector2(p.x, p.z)) / Math.max(dt, 0.001);
    a.bob += Math.min(speed, 6) * dt * 1.6;
    a.body.position.y = 0.9 + (speed > 0.4 ? Math.abs(Math.sin(a.bob)) * 0.04 : 0);
    a.prev.set(p.x, p.z);
  }

  for (const [id, a] of avatars) {
    if (id === net.selfId || seen.has(id)) continue;
    scene.remove(a.group);
    avatars.delete(id);
  }

  // --- camera ---
  // Camera height MUST stay under the ceiling (y = 5) and under the lamps
  // (y = 4.4). The first two passes sat at 7.2 and 5.4, which put the lens
  // above the ceiling plane — it is single-sided, so the room read as an open
  // plane under a black sky, and the central lamp cage filled the frame.
  // 2.6 m is roughly standing eye height and keeps the whole volume readable.
  // In the drift the ceiling drops to 2.6 m, so the Commons framing would put
  // the lens inside the rock. Duck under it and pull in close — which also
  // makes the drift feel tight, so the constraint and the mood agree.
  // The drift is 4 m wide and 2.6 m high, so the camera has to stay ON the
  // tunnel axis — an offset that works in a 40 m room puts the lens inside
  // solid rock in here. Sit behind the player along the drift and clamp to
  // the centreline.
  const want = inDeep
    ? new THREE.Vector3(
        net.self.x - 5.5,
        1.7,
        THREE.MathUtils.clamp(net.self.z, -1.0, 1.0)
      )
    : new THREE.Vector3(net.self.x, 2.6, net.self.z + 7.0);
  // Exponential smoothing so the feel is identical at 60 and 144 fps.
  camPos.lerp(want, 1 - Math.exp(-7 * dt));
  camera.position.copy(camPos);
  // Sway, coupled to walking. Purely cosmetic and it is most of what people
  // mean when they say a game "feels good".
  camera.position.x += Math.sin(walkPhase * 0.5) * (moving ? 0.045 : 0);
  // In the drift, look PAST the player down the tunnel rather than at them —
  // what matters in the dark is what is ahead, not the back of your own head.
  if (inDeep) camera.lookAt(net.self.x + 6, 1.2, net.self.z);
  else camera.lookAt(net.self.x, 1.1, net.self.z);

  const mins = Math.floor(lampCharge / 60);
  const secs = String(Math.floor(lampCharge % 60)).padStart(2, "0");
  const lampLabel = lampCharge <= 0 ? "DEAD" : `${mins}:${secs}`;

  hud.textContent =
    `ASHFALL · MARROW · ${inDeep ? "the drift east — unlit" : "Level 2 — The Commons"}\n` +
    `Year Eleven\n\n` +
    `${name}\n` +
    `in the bunker (${roster.length}): ${roster.join(", ") || "—"}\n\n` +
    `headlamp  [${lampOn ? "ON " : "off"}]  ${lampLabel}\n` +
    `WASD move · F headlamp · H ${hum.running ? "cut the handlers" : "restore power"}\n` +
    (inDeep && !lampLive ? `\n>> YOU CANNOT SEE. <<\n` : "") +
    (lampCharge > 0 && lampCharge < 20 && lampLive ? `\n>> the lamp is going. <<\n` : "") +
    (humOff
      ? `\n>> THE HUM HAS STOPPED. YOU ARE AUDIBLE. <<`
      : hum.started
        ? ""
        : `\n(press any key — the air handlers need a moment)`);

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
