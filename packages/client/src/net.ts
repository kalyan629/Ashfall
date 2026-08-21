/**
 * Networking, prediction, and reconciliation.
 *
 * Three ideas live here, and they are the three that make a multiplayer game
 * feel good rather than merely work:
 *
 * 1. PREDICTION — when you press a key, we move you immediately using the
 *    shared simulation, without waiting for the server. Otherwise every step
 *    costs a full round trip and the game feels underwater.
 *
 * 2. RECONCILIATION — the server's snapshot is the truth, but it is always
 *    slightly stale by the time it arrives. So we take the authoritative
 *    position, then replay every input the server has not acknowledged yet on
 *    top of it. If our prediction was right, we land where we already were and
 *    nothing visibly happens. That silence is the whole point.
 *
 * 3. INTERPOLATION — other players are rendered ~100 ms in the past, between
 *    the two most recent snapshots. Rendering them at the newest snapshot
 *    instead makes them teleport 20 times a second.
 */

import {
  INTERP_DELAY_MS,
  applyInput,
  type Input,
  type PlayerState,
  type ServerMsg,
} from "@ashfall/shared";

export interface RemoteSample {
  t: number;
  players: Map<string, PlayerState>;
}

export class Net {
  socket: WebSocket;
  selfId: string | null = null;

  /** Our predicted position. Authoritative for rendering ourselves. */
  self = { x: 0, z: 0 };

  /** Inputs sent but not yet acknowledged, kept for replay. */
  private pending: Input[] = [];
  private seq = 0;

  /** Snapshot history for interpolating everyone else. */
  private buffer: RemoteSample[] = [];

  /** Server clock minus our clock, so we can render at (now - delay). */
  private clockOffset = 0;

  onRoster: (names: string[]) => void = () => {};

  constructor(url: string, name: string) {
    this.socket = new WebSocket(url);
    this.socket.addEventListener("open", () => {
      this.socket.send(JSON.stringify({ t: "join", name }));
    });
    this.socket.addEventListener("message", (ev) => {
      this.handle(JSON.parse(ev.data as string) as ServerMsg);
    });
  }

  private handle(msg: ServerMsg): void {
    if (msg.t === "welcome") {
      this.selfId = msg.id;
      return;
    }

    if (msg.t !== "snapshot") return;

    const now = Date.now();
    this.clockOffset = msg.serverTime - now;

    const map = new Map<string, PlayerState>();
    for (const p of msg.players) map.set(p.id, p);
    this.buffer.push({ t: msg.serverTime, players: map });

    // Keep a second of history; older samples can never be rendered.
    while (this.buffer.length > 2 && now - (this.buffer[0].t - this.clockOffset) > 1000) {
      this.buffer.shift();
    }

    this.onRoster(msg.players.map((p) => p.name));

    // --- Reconciliation -------------------------------------------------
    const me = this.selfId ? map.get(this.selfId) : undefined;
    if (!me) return;

    // Start from the server's truth...
    this.self.x = me.x;
    this.self.z = me.z;

    // ...drop everything it has already accounted for...
    this.pending = this.pending.filter((i) => i.seq > me.ack);

    // ...and replay the rest. Same code the server ran, so we should land
    // exactly where we already predicted and the player sees nothing at all.
    for (const input of this.pending) applyInput(this.self, input);
  }

  /** Send one frame of intent and predict its effect immediately. */
  sendInput(dx: number, dz: number, dt: number): void {
    if (this.socket.readyState !== WebSocket.OPEN || !this.selfId) return;

    const input: Input = { seq: ++this.seq, dx, dz, dt };
    this.pending.push(input);

    // Predict now. Do not wait for the round trip.
    applyInput(this.self, input);

    this.socket.send(JSON.stringify({ t: "input", input }));
  }

  /**
   * Where should everyone else be drawn this frame?
   *
   * We render at (server time now - INTERP_DELAY_MS), find the two snapshots
   * that straddle that instant, and blend between them.
   */
  interpolated(): PlayerState[] {
    const renderTime = Date.now() + this.clockOffset - INTERP_DELAY_MS;

    let a: RemoteSample | null = null;
    let b: RemoteSample | null = null;
    for (let i = 0; i < this.buffer.length - 1; i++) {
      if (this.buffer[i].t <= renderTime && this.buffer[i + 1].t >= renderTime) {
        a = this.buffer[i];
        b = this.buffer[i + 1];
        break;
      }
    }

    // Not enough history yet, or we have fallen behind the buffer: show the
    // newest thing we have rather than nothing.
    if (!a || !b) {
      const last = this.buffer[this.buffer.length - 1];
      return last ? [...last.players.values()] : [];
    }

    const span = b.t - a.t;
    const f = span > 0 ? (renderTime - a.t) / span : 0;

    const out: PlayerState[] = [];
    for (const [id, pb] of b.players) {
      const pa = a.players.get(id);
      if (!pa) {
        out.push(pb); // just appeared; nothing to blend from
        continue;
      }
      out.push({
        ...pb,
        x: pa.x + (pb.x - pa.x) * f,
        z: pa.z + (pb.z - pa.z) * f,
      });
    }
    return out;
  }
}
