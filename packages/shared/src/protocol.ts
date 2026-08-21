/**
 * The wire protocol. Imported by BOTH the client and the server.
 *
 * This file is the contract. A field added on one side only is a bug, which is
 * exactly why it lives in a shared package instead of being written twice.
 */

/** Server simulation rate. 20 Hz is the standard choice for this kind of game:
 *  fast enough that 50 ms of input lag is imperceptible once prediction is on,
 *  slow enough that bandwidth and CPU stay cheap with many players. */
export const TICK_HZ = 20;
export const TICK_MS = 1000 / TICK_HZ;

/** Metres per second. Deliberately slow -- Marrow is a place you trudge. */
export const PLAYER_SPEED = 4.0;

/** Player collision radius, metres. */
export const PLAYER_RADIUS = 0.4;

/** How far in the past remote players are rendered, in milliseconds.
 *  Snapshots arrive every 50 ms, so buffering 100 ms means we almost always
 *  have two snapshots to interpolate between even if one is late or lost. */
export const INTERP_DELAY_MS = 100;

export type PlayerId = string;

export interface PlayerState {
  id: PlayerId;
  name: string;
  x: number;
  z: number;
  /** Last input sequence number the server has processed for this player.
   *  The client uses this to discard acknowledged inputs during reconciliation. */
  ack: number;
}

/** One frame of intent. Never a position -- the client asks, the server decides.
 *  Sending positions instead of intent is how you get teleporting speedhackers. */
export interface Input {
  seq: number;
  /** Normalised direction, each in [-1, 1]. The server re-normalises anyway. */
  dx: number;
  dz: number;
  /** Seconds this input covers. Server clamps it; see applyInput. */
  dt: number;
}

export type ClientMsg =
  | { t: "join"; name: string }
  | { t: "input"; input: Input };

export type ServerMsg =
  | { t: "welcome"; id: PlayerId; tick: number }
  | { t: "snapshot"; tick: number; serverTime: number; players: PlayerState[] };
