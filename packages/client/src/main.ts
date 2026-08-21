/**
 * ASHFALL client — Phase 0.
 *
 * One room of Level 2, The Commons. Enough to prove the thing that matters:
 * two browser tabs, two avatars, both authoritative, both smooth.
 *
 * Art direction is already applied here rather than left for later, because
 * "warm sodium pools against cold dark" is the identity of the whole game and
 * it costs nothing to establish on day one. See docs/WORLD.md section 8.
 */

import * as THREE from "three";
import { COLLIDERS, PLAYER_RADIUS, ROOM_HALF_X, ROOM_HALF_Z } from "@ashfall/shared";
import { Net } from "./net.js";

// --- palette (docs/WORLD.md 8.2) -----------------------------------------
const SODIUM = 0xffa94d; // the colour of safety
const VERDIGRIS = 0x4a8c7a; // copper oxide, Marrow's signature
const COLD = 0x1a1f24; // the canvas

// --- boot -----------------------------------------------------------------
const name =
  new URLSearchParams(location.search).get("name") ??
  `survivor-${Math.floor(Math.random() * 900 + 100)}`;

const wsUrl =
  new URLSearchParams(location.search).get("server") ??
  `ws://${location.hostname}:8080`;

const net = new Net(wsUrl, name);

const scene = new THREE.Scene();
scene.background = new THREE.Color(COLD);
scene.fog = new THREE.Fog(COLD, 18, 46);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 200);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
// Cap DPR. On a high-DPI laptop, rendering at native 3x costs ~9x the pixels
// for a difference almost nobody can see.
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// --- the room -------------------------------------------------------------
// Ambient is deliberately very low. Marrow is dark; the lamps do the work.
scene.add(new THREE.AmbientLight(0x404a55, 0.35));

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(ROOM_HALF_X * 2, ROOM_HALF_Z * 2),
  new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.95 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// Colliders are rendered directly from the shared definition, so what you see
// is exactly what you collide with. Any drift between art and collision is a
// bug you would otherwise find only by walking into an invisible wall.
const wallMat = new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.9 });
const pillarMat = new THREE.MeshStandardMaterial({ color: VERDIGRIS, roughness: 0.8 });

for (const b of COLLIDERS) {
  const isPillar = b.hx < 2 && b.hz < 2;
  const h = isPillar ? 4 : 3;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(b.hx * 2, h, b.hz * 2),
    isPillar ? pillarMat : wallMat
  );
  mesh.position.set(b.x, h / 2, b.z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
}

// Sodium lamps: warm pools with harsh falloff, the signature of the inhabited
// levels. Distance-limited point lights are also cheap, which matters.
for (const [lx, lz] of [[-10, -6], [10, -6], [-10, 6], [10, 6], [0, 0]]) {
  const lamp = new THREE.PointLight(SODIUM, 40, 22, 2);
  lamp.position.set(lx, 4.2, lz);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(512, 512);
  scene.add(lamp);

  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 8, 8),
    new THREE.MeshBasicMaterial({ color: SODIUM })
  );
  bulb.position.copy(lamp.position);
  scene.add(bulb);
}

// --- avatars --------------------------------------------------------------
const avatarGeo = new THREE.CapsuleGeometry(PLAYER_RADIUS, 1.0, 4, 12);

function makeNameTag(text: string): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.font = "bold 30px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineWidth = 6;
  g.strokeStyle = "rgba(0,0,0,0.85)";
  g.strokeText(text, 128, 32);
  g.fillStyle = "#f2e6d0";
  g.fillText(text, 128, 32);

  const tex = new THREE.CanvasTexture(c);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true })
  );
  sprite.scale.set(2.4, 0.6, 1);
  return sprite;
}

interface Avatar {
  group: THREE.Group;
  tag: THREE.Sprite;
  label: string;
}

const avatars = new Map<string, Avatar>();

function avatarFor(id: string, label: string, isSelf: boolean): Avatar {
  let a = avatars.get(id);
  if (a) {
    if (a.label !== label) {
      a.group.remove(a.tag);
      a.tag = makeNameTag(label);
      a.tag.position.y = 2.05;
      a.group.add(a.tag);
      a.label = label;
    }
    return a;
  }

  const group = new THREE.Group();
  const body = new THREE.Mesh(
    avatarGeo,
    new THREE.MeshStandardMaterial({
      color: isSelf ? 0xd9c9a8 : 0x8f9aa5,
      roughness: 0.7,
    })
  );
  body.position.y = 0.9;
  body.castShadow = true;
  group.add(body);

  const tag = makeNameTag(label);
  tag.position.y = 2.05;
  group.add(tag);

  scene.add(group);
  a = { group, tag, label };
  avatars.set(id, a);
  return a;
}

// --- input ----------------------------------------------------------------
const held = new Set<string>();
addEventListener("keydown", (e) => held.add(e.key.toLowerCase()));
addEventListener("keyup", (e) => held.delete(e.key.toLowerCase()));
addEventListener("blur", () => held.clear()); // otherwise alt-tab sticks a key on

function intent(): { dx: number; dz: number } {
  let dx = 0;
  let dz = 0;
  if (held.has("w") || held.has("arrowup")) dz -= 1;
  if (held.has("s") || held.has("arrowdown")) dz += 1;
  if (held.has("a") || held.has("arrowleft")) dx -= 1;
  if (held.has("d") || held.has("arrowright")) dx += 1;

  // Normalise so diagonals are not 1.41x faster. Every first multiplayer
  // prototype ships with this bug at least once.
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
net.onRoster = (names) => {
  roster = names;
};

// --- loop -----------------------------------------------------------------
let last = performance.now();

function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  const { dx, dz } = intent();
  // Send every frame, including idle frames. A gap in the sequence is
  // indistinguishable from a dropped packet on the server side.
  net.sendInput(dx, dz, dt);

  // Self, drawn from our own prediction — never from the snapshot, which is
  // always at least half a round trip stale.
  if (net.selfId) {
    const me = avatarFor(net.selfId, name, true);
    me.group.position.set(net.self.x, 0, net.self.z);
  }

  // Everyone else, interpolated ~100 ms in the past.
  const seen = new Set<string>();
  for (const p of net.interpolated()) {
    seen.add(p.id);
    if (p.id === net.selfId) continue;
    const a = avatarFor(p.id, p.name, false);
    a.group.position.set(p.x, 0, p.z);
  }

  for (const [id, a] of avatars) {
    if (id === net.selfId || seen.has(id)) continue;
    scene.remove(a.group);
    avatars.delete(id);
  }

  // Third-person chase camera, slightly high and behind.
  const target = new THREE.Vector3(net.self.x, 1.2, net.self.z);
  const want = new THREE.Vector3(net.self.x, 7.5, net.self.z + 9.5);
  // Exponential smoothing, frame-rate independent. Using a raw lerp factor
  // here would make the camera feel different at 60 fps and 144 fps.
  camera.position.lerp(want, 1 - Math.exp(-6 * dt));
  camera.lookAt(target);

  hud.textContent =
    `ASHFALL · Marrow · Level 2, The Commons\n` +
    `you: ${name}\n` +
    `in the bunker (${roster.length}): ${roster.join(", ") || "—"}\n` +
    `WASD to move`;

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
