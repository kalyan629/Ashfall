/**
 * The hum.
 *
 * Marrow's ventilation is a constant low drone. It is the sound of the shelter
 * being alive, and players stop consciously hearing it within about a minute —
 * which is exactly the point, because the mechanic is what happens when it
 * STOPS. See docs/WORLD.md 8.5.
 *
 * Silence is load-bearing: the hum masks your own noise from Drift. When the
 * handlers cut, you become audible. The player should feel that in their spine
 * before they intellectually understand it.
 *
 * Generated entirely in WebAudio rather than shipped as a file. No asset, no
 * download, no loop seam — and the pitch and depth can be modulated live, which
 * a recording could never do.
 */

export class Hum {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private nodes: AudioNode[] = [];
  private lfoGain: GainNode | null = null;

  running = false;

  /** Has audio ever been initialised? Distinct from `running`: before the first
   *  keypress WebAudio cannot start at all, so `running` is false without the
   *  hum having ever existed. Treating that as "the hum stopped" showed the
   *  YOU ARE AUDIBLE alarm on page load, which is exactly backwards. */
  started = false;

  /** WebAudio cannot start before a user gesture, so this is called on the
   *  first keypress rather than at load. */
  start(): void {
    if (this.ctx) return;

    const ctx = new AudioContext();
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    this.master = master;

    // --- the body of the drone: filtered noise -----------------------------
    // Two seconds of brown noise, looped. Brown (not white) because the energy
    // sits low, which is what large slow-moving air actually sounds like.
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 220;
    lp.Q.value = 0.7;

    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.55;

    noise.connect(lp).connect(noiseGain).connect(master);
    noise.start();
    this.nodes.push(noise, lp, noiseGain);

    // --- the pitched core: big slow fans -----------------------------------
    // 48 Hz and a slightly detuned 72 Hz. The beating between them keeps the
    // drone from sounding synthetic and dead.
    for (const [freq, gain] of [[48, 0.09], [72.3, 0.05]] as const) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = gain;
      osc.connect(g).connect(master);
      osc.start();
      this.nodes.push(osc, g);
    }

    // --- the wobble --------------------------------------------------------
    // A very slow LFO on the filter cutoff. Real plant does not hold a
    // perfectly steady note; it surges and sags as load changes.
    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 60;
    lfo.connect(lfoGain).connect(lp.frequency);
    lfo.start();
    this.lfoGain = lfoGain;
    this.nodes.push(lfo, lfoGain);

    // Fade in over four seconds. An instant drone announces itself; a slow one
    // is simply there, which is how you stop noticing it.
    master.gain.linearRampToValueAtTime(0.22, ctx.currentTime + 4);
    this.running = true;
    this.started = true;
  }

  /**
   * The handlers cut out.
   *
   * Not an instant mute — real machinery spins down. Two seconds of falling
   * pitch and volume, and then nothing at all. The absence is the event.
   */
  stop(): void {
    if (!this.ctx || !this.master || !this.running) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(0.0001, t + 2.0);

    // Spin down the fans as they lose power.
    for (const n of this.nodes) {
      if (n instanceof OscillatorNode) {
        n.frequency.cancelScheduledValues(t);
        n.frequency.setValueAtTime(n.frequency.value, t);
        n.frequency.linearRampToValueAtTime(n.frequency.value * 0.55, t + 2.0);
      }
    }
    this.running = false;
  }

  /** Power restored. Comes back the way it left: slowly. */
  resume(): void {
    if (!this.ctx || !this.master || this.running) return;
    const t = this.ctx.currentTime;
    for (const n of this.nodes) {
      if (n instanceof OscillatorNode) {
        n.frequency.cancelScheduledValues(t);
        n.frequency.linearRampToValueAtTime(
          n === this.nodes.find((x) => x instanceof OscillatorNode) ? 48 : 72.3,
          t + 3.0
        );
      }
    }
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.linearRampToValueAtTime(0.22, t + 3.0);
    this.running = true;
    this.started = true;
  }

  toggle(): void {
    this.running ? this.stop() : this.resume();
  }
}
