/**
 * The inhabitants of Marrow, embodied.
 *
 * SEPARATION OF CONCERNS, and it is load-bearing: `@ashfall/sim` owns
 * cognition — beliefs, memory, trust, needs — and knows nothing about space.
 * This file owns bodies. Keeping the simulation spatially ignorant is what
 * lets it run headless at 100x speed for experiments; the moment cognition
 * depends on x/z, every experiment needs a world to run in.
 *
 * NPCs move using `applyInput` from `@ashfall/shared` — the exact same
 * function the players and the authoritative server use. They therefore
 * collide with the same walls, at the same radius, with the same resolution
 * behaviour. A separate NPC movement path would drift out of sync with player
 * movement the first time either changed.
 */

import {
  applyInput,
  type NpcState,
  type Vec2,
} from "@ashfall/shared";
import {
  createSim,
  step as simStep,
  WORLD_SECONDS_PER_TICK,
  type Sim,
} from "@ashfall/sim";
import { JsonlEventStore } from "@ashfall/sim/persist";
import { serializeSim, restoreSim, type WorldSnapshot } from "@ashfall/sim/snapshot";
import { dominantNeed, type Agent } from "@ashfall/sim/agent";

/** Where people in the Commons actually go, and why. */
interface Waypoint {
  name: string;
  activity: string;
  x: number;
  z: number;
  /** Metres of scatter, so a crowd does not stack on one point. */
  spread: number;
}

const WAYPOINTS: Record<string, Waypoint> = {
  canteen: { name: "canteen", activity: "queueing for rations", x: 0, z: 3.5, spread: 4.5 },
  water: { name: "water", activity: "filling a can", x: 14, z: 7.5, spread: 1.8 },
  bunks: { name: "bunks", activity: "sleeping", x: -14, z: 9.5, spread: 3.2 },
  noticeboard: { name: "noticeboard", activity: "reading the board", x: -15.5, z: -10.5, spread: 2.0 },
  lift: { name: "lift", activity: "waiting for the cage", x: 16.5, z: -10.5, spread: 2.2 },
  works: { name: "works", activity: "servicing a scrubber", x: -10, z: -6, spread: 2.5 },
  grow: { name: "grow", activity: "tending a tray", x: 10, z: -6, spread: 2.5 },
  driftmouth: { name: "driftmouth", activity: "eyeing the drift", x: 17.5, z: 0, spread: 1.4 },
};

/** Occupation determines where you work; needs override where you'd rather be. */
const WORKPLACE: Record<string, keyof typeof WAYPOINTS> = {
  scrubber: "works",
  grower: "grow",
  digger: "driftmouth",
  trader: "canteen",
  custody: "lift",
  idle: "noticeboard",
};

/** Which need arriving at a waypoint actually relieves, and by how much. */
const RELIEVES: Record<string, { need: keyof Agent["needs"]; amount: number } | null> = {
  canteen: { need: "hunger", amount: 0.55 },
  water: { need: "thirst", amount: 0.7 },
  bunks: { need: "fatigue", amount: 0.5 },
  noticeboard: { need: "social", amount: 0.3 },
  lift: null,
  works: null,
  grow: { need: "hunger", amount: 0.1 }, // growers nibble
  driftmouth: null,
};

interface Body {
  agent: Agent;
  pos: Vec2;
  target: Vec2;
  activity: string;
  /** Which waypoint this body is heading for, so arrival can relieve a need. */
  destination: string;
  /** Set once arrival has been credited, so standing there is not infinite food. */
  satisfied: boolean;
  /** Ticks until this body reconsiders where it is going. */
  rethink: number;
}

/** Cognition ticks per real second while the server is up. */
const COGNITION_HZ = 5;

/**
 * Ceiling on offline catch-up, in ticks.
 *
 * A world left down for a month must not spend twenty minutes simulating its
 * way back before the first player can connect. Beyond this the gap is
 * acknowledged rather than lived through — survivors will have needs and
 * beliefs consistent with the cap, not with the true elapsed time. That is a
 * deliberate, documented approximation, not an accident.
 */
const MAX_CATCHUP_TICKS = 20_000; // ~66 world-hours

export class Population {
  sim: Sim;
  private bodies: Body[] = [];
  /** The sim runs slower than the netcode. Cognition does not need 20 Hz. */
  private simAccumulator = 0;
  private store: JsonlEventStore<WorldSnapshot> | null = null;
  private ticksSinceSave = 0;

  constructor(count: number, seed = 20260821) {
    this.sim = createSim({ seed, population: count, memoryMode: "episodic" });

    for (const agent of this.sim.agents) {
      const r = agent.rng;
      const start = WAYPOINTS[WORKPLACE[agent.identity.occupation] ?? "canteen"];
      const pos = {
        x: start.x + (r() - 0.5) * start.spread * 2,
        z: start.z + (r() - 0.5) * start.spread * 2,
      };
      this.bodies.push({
        agent,
        pos,
        target: { ...pos },
        activity: start.activity,
        destination: start.name,
        satisfied: false,
        rethink: Math.floor(r() * 400),
      });
    }
  }

  /**
   * Choose where this survivor wants to be.
   *
   * Needs beat occupation, which is the whole point of modelling needs at all:
   * a thirsty scrubber stops scrubbing. The thresholds are high enough that
   * most of the crowd is working most of the time, so the Commons reads as a
   * functioning shelter rather than a mob of people milling about.
   */
  private chooseTarget(b: Body): void {
    const { need, pressure } = dominantNeed(b.agent.needs);
    let wp: Waypoint;

    if (pressure > 0.62 && (need === "thirst" || need === "hunger")) {
      wp = WAYPOINTS[need === "thirst" ? "water" : "canteen"];
    } else if (pressure > 0.7 && need === "fatigue") {
      wp = WAYPOINTS.bunks;
    } else if (pressure > 0.55 && need === "social") {
      wp = WAYPOINTS.canteen;
    } else if (b.agent.rng() < 0.25) {
      // Even working people wander. Without this the crowd is static furniture.
      wp = WAYPOINTS.noticeboard;
    } else {
      wp = WAYPOINTS[WORKPLACE[b.agent.identity.occupation] ?? "canteen"];
    }

    const r = b.agent.rng;
    b.target = {
      x: wp.x + (r() - 0.5) * wp.spread * 2,
      z: wp.z + (r() - 0.5) * wp.spread * 2,
    };
    b.activity = wp.activity;
    b.destination = wp.name;
    b.satisfied = false;
    // Re-decide in 12-30 seconds of sim time, staggered so nobody moves in unison.
    b.rethink = 240 + Math.floor(r() * 360);
  }

  /**
   * Attach durable storage, restore any existing world, and live through the
   * time the server was down.
   *
   * OFFLINE FAST-FORWARD uses approach B: run the real simulation, headless,
   * as fast as the CPU allows. Not an approximation of cognition — the actual
   * cognition, just without a 200 ms wait between ticks. The headless design
   * that exists for experiments is exactly what makes this possible, so an
   * offline gap is literally an accelerated experiment run on the same engine.
   *
   * The alternative — analytically advancing needs and skipping gossip — would
   * mean the world evolves by different rules when unobserved, which is the one
   * thing a persistent world cannot afford.
   */
  async attach(dir: string): Promise<{ restored: boolean; caughtUp: number }> {
    const store = new JsonlEventStore<WorldSnapshot>(dir);
    await store.init();
    this.store = store;

    const loaded = await store.restore();
    if (!loaded) return { restored: false, caughtUp: 0 };

    restoreSim(this.sim, loaded.state);
    // Bodies are NOT persisted. Positions are cheap to regenerate and nobody
    // notices a survivor standing two metres from where they were; beliefs and
    // grudges are what must survive. Rebind bodies onto the restored agents.
    this.rebind();

    const savedAt = (loaded.state as WorldSnapshot & { savedAtMs?: number }).savedAtMs;
    if (!savedAt) return { restored: true, caughtUp: 0 };

    const downSeconds = Math.max(0, (Date.now() - savedAt) / 1000);
    const owed = Math.floor(downSeconds * COGNITION_HZ);
    const catchup = Math.min(owed, MAX_CATCHUP_TICKS);

    for (let i = 0; i < catchup; i++) simStep(this.sim);
    if (catchup > 0) this.advanceBodies(Math.min(catchup / COGNITION_HZ, 600));

    return { restored: true, caughtUp: catchup };
  }

  /** Point bodies at the restored agent objects. */
  private rebind(): void {
    const old = new Map(this.bodies.map((b) => [b.agent.identity.id, b]));
    this.bodies = this.sim.agents.map((agent) => {
      const prev = old.get(agent.identity.id);
      const r = agent.rng;
      const start = WAYPOINTS[WORKPLACE[agent.identity.occupation] ?? "canteen"];
      return {
        agent,
        pos: prev?.pos ?? {
          x: start.x + (r() - 0.5) * start.spread * 2,
          z: start.z + (r() - 0.5) * start.spread * 2,
        },
        target: prev?.target ?? { x: start.x, z: start.z },
        activity: prev?.activity ?? start.activity,
        destination: prev?.destination ?? start.name,
        satisfied: false,
        rethink: 1,
      };
    });
  }

  /** Move bodies without re-running cognition, used during catch-up. */
  private advanceBodies(seconds: number): void {
    for (let t = 0; t < seconds; t += 0.05) this.moveBodies(0.05);
  }

  async save(): Promise<void> {
    if (!this.store) return;
    await this.store.append([...this.sim.log.all()]);
    const snap = serializeSim(this.sim) as WorldSnapshot & { savedAtMs: number };
    // The wall-clock stamp is what makes offline duration knowable. worldTime
    // alone cannot tell you how long the process was actually down.
    snap.savedAtMs = Date.now();
    await this.store.snapshot(snap);
  }

  /** @param dt seconds since last call */
  update(dt: number): void {
    // Cognition at ~5 Hz. Beliefs and gossip do not need netcode cadence, and
    // this is the first place the LOD work will land when the population grows.
    this.simAccumulator += dt;
    while (this.simAccumulator >= 0.2) {
      simStep(this.sim);
      this.simAccumulator -= 0.2;
    }

    // Periodic snapshot. Every ~30 s of real time bounds worst-case loss to
    // that window; the durable event log covers what happened in between.
    if (this.store && ++this.ticksSinceSave >= 600) {
      this.ticksSinceSave = 0;
      void this.save().catch((e) => console.error("[ashfall] snapshot failed:", e));
    }

    this.moveBodies(dt);
  }

  /** One step of physical movement for every body. */
  private moveBodies(dt: number): void {
    for (const b of this.bodies) {
      if (--b.rethink <= 0) this.chooseTarget(b);

      const dx = b.target.x - b.pos.x;
      const dz = b.target.z - b.pos.z;
      const dist = Math.hypot(dx, dz);

      // Arrived: stand still rather than jitter around the target point.
      if (dist < 0.35) {
        // Closing the loop. decayNeeds only ever RAISES need, so without a
        // relief step the whole population saturates and stands at the water
        // point forever — which is exactly what it did on first run. Credited
        // once per trip, not per tick, or standing at the canteen is infinite
        // food and nobody ever leaves.
        if (!b.satisfied) {
          const relief = RELIEVES[b.destination];
          if (relief) {
            b.agent.needs[relief.need] = Math.max(0, b.agent.needs[relief.need] - relief.amount);
          }
          b.satisfied = true;
        }
        continue;
      }

      // Survivors walk. Players run — the speed difference is free
      // characterisation: nobody in a bunker is in a hurry except you.
      const speed = 0.42;
      applyInput(b.pos, {
        seq: 0,
        dx: (dx / dist) * speed,
        dz: (dz / dist) * speed,
        dt: Math.min(dt, 0.1),
      });
    }
  }

  /**
   * Snapshot for the wire.
   *
   * Culled by distance to the viewer: this is deliberately the same shape as
   * the interest management that Phase 7 needs, just with a naive linear scan
   * instead of a spatial index. Getting the *contract* right early means the
   * later optimisation is a drop-in.
   */
  snapshotFor(viewer: Vec2, radius = 34): NpcState[] {
    const out: NpcState[] = [];
    const r2 = radius * radius;
    for (const b of this.bodies) {
      const dx = b.pos.x - viewer.x;
      const dz = b.pos.z - viewer.z;
      if (dx * dx + dz * dz > r2) continue;
      out.push({
        id: b.agent.identity.id,
        name: b.agent.identity.name,
        x: Math.round(b.pos.x * 100) / 100,
        z: Math.round(b.pos.z * 100) / 100,
        occupation: b.agent.identity.occupation,
        activity: b.activity,
      });
    }
    return out;
  }

  get count(): number {
    return this.bodies.length;
  }
}
