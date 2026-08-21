/**
 * The world, and the movement rule that acts on it.
 *
 * THIS IS THE MOST IMPORTANT FILE IN THE PROJECT and it is worth saying why.
 *
 * Client-side prediction works by the client running the *same* simulation the
 * server runs, immediately, without waiting for a round trip. When the server's
 * answer arrives, the client replays its unacknowledged inputs on top and
 * should land on exactly the same position it already predicted.
 *
 * "Exactly" is load-bearing. If the two sides disagree by even a rounding
 * error, every snapshot yanks the player a few centimetres and the game
 * rubber-bands. The only reliable way to guarantee they agree is to have one
 * copy of the code, imported by both. Hence: this file, in `shared`.
 *
 * Corollary: never make movement depend on anything the server cannot see --
 * no frame rate, no Math.random(), no Date.now().
 */

import { PLAYER_RADIUS, PLAYER_SPEED, type Input } from "./protocol.js";

/** What a collider IS, declared rather than guessed.
 *
 *  The renderer used to infer this from dimensions (`hz < 1 && hx > 2` meant
 *  bench). The perimeter walls are hx:20, hz:0.5 — which matches that test —
 *  so both long walls rendered 0.8 m tall and the room had skirting boards
 *  instead of walls. Collision was unaffected, so no test caught it; it was
 *  only visible on screen. Never infer a thing's role from its measurements. */
export type BoxKind = "wall" | "pillar" | "bench";

export interface Box {
  /** Centre. */
  x: number;
  z: number;
  /** Half-extents. */
  hx: number;
  hz: number;
  kind: BoxKind;
  /** Height in metres. Collision is 2D, so this is purely for rendering. */
  h: number;
}

export interface Vec2 {
  x: number;
  z: number;
}

/**
 * Phase 0 test space: one room from Level 2, The Commons, with a couple of
 * interior obstructions so collision is actually exercised. Hand-authored
 * on purpose -- every named place in Marrow is built by hand.
 */
export const ROOM_HALF_X = 20;
export const ROOM_HALF_Z = 14;

export const ROOM_HEIGHT = 5;

export const COLLIDERS: Box[] = [
  // Perimeter walls, 1 m thick, sitting just inside the room bounds.
  { x: 0, z: -ROOM_HALF_Z, hx: ROOM_HALF_X, hz: 0.5, kind: "wall", h: ROOM_HEIGHT },
  { x: 0, z: ROOM_HALF_Z, hx: ROOM_HALF_X, hz: 0.5, kind: "wall", h: ROOM_HEIGHT },
  { x: -ROOM_HALF_X, z: 0, hx: 0.5, hz: ROOM_HALF_Z, kind: "wall", h: ROOM_HEIGHT },
  { x: ROOM_HALF_X, z: 0, hx: 0.5, hz: ROOM_HALF_Z, kind: "wall", h: ROOM_HEIGHT },

  // Support pillars. Mines are full of them and they make good cover.
  { x: -6, z: -3, hx: 1.2, hz: 1.2, kind: "pillar", h: ROOM_HEIGHT },
  { x: 7, z: 4, hx: 1.2, hz: 1.2, kind: "pillar", h: ROOM_HEIGHT },

  // Canteen benches -- the reason people gather here.
  { x: 0, z: 6, hx: 5, hz: 0.6, kind: "bench", h: 0.8 },
  { x: 0, z: 8.5, hx: 5, hz: 0.6, kind: "bench", h: 0.8 },
];

/** Push a circle out of a box along whichever axis it overlaps least. */
function resolveCircleBox(p: Vec2, b: Box, r: number): void {
  const dx = p.x - b.x;
  const dz = p.z - b.z;
  const overlapX = b.hx + r - Math.abs(dx);
  const overlapZ = b.hz + r - Math.abs(dz);

  if (overlapX <= 0 || overlapZ <= 0) return; // not touching

  // Eject along the shallower axis: that is the surface actually being hit.
  if (overlapX < overlapZ) {
    p.x += dx >= 0 ? overlapX : -overlapX;
  } else {
    p.z += dz >= 0 ? overlapZ : -overlapZ;
  }
}

/**
 * Advance one player by one input. Pure: same inputs, same output, always.
 *
 * Mutates and returns `pos` for the caller's convenience.
 */
export function applyInput(pos: Vec2, input: Input): Vec2 {
  // Clamp dt server-side as well as client-side. An unclamped dt is the
  // oldest speedhack there is: claim a 10-second frame and cross the map.
  const dt = Math.max(0, Math.min(input.dt, 0.1));

  let { dx, dz } = input;

  // Re-normalise rather than trusting the client. Otherwise dx=99,dz=99
  // arrives and the player is gone.
  const len = Math.hypot(dx, dz);
  if (len > 1) {
    dx /= len;
    dz /= len;
  }

  pos.x += dx * PLAYER_SPEED * dt;
  pos.z += dz * PLAYER_SPEED * dt;

  // Resolve twice. One pass can push the circle out of one box and straight
  // into another; a second pass settles the corner cases cheaply.
  for (let pass = 0; pass < 2; pass++) {
    for (const b of COLLIDERS) resolveCircleBox(pos, b, PLAYER_RADIUS);
  }

  return pos;
}

/** A spawn point on Level 1, The Landing -- where new players arrive. */
export function spawnPoint(seed: number): Vec2 {
  // Deterministic ring so two players never spawn inside each other.
  const a = (seed * 2.399963) % (Math.PI * 2);
  return { x: Math.cos(a) * 3, z: -8 + Math.sin(a) * 2 };
}
