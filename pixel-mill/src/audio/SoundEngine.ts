/**
 * Synthesised machine audio: a spindle whine whose pitch follows RPM and a
 * band-passed, amplitude-modulated noise layer for cutting. No audio files.
 * The AudioContext is created lazily on the first enable (needs a user gesture).
 */
export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private whineGain!: GainNode;
  private oscs: { osc: OscillatorNode; mult: number }[] = [];
  private cutGain!: GainNode;
  private cutFilter!: BiquadFilterNode;
  private toothLfo!: OscillatorNode;
  private toothDepth!: GainNode;
  private enabled = false;
  private cutLevel = 0;

  setEnabled(on: boolean) {
    this.enabled = on;
    if (on && !this.ctx) this.build();
    if (!this.ctx) return;
    if (on) void this.ctx.resume();
    else void this.ctx.suspend();
  }

  private build() {
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.22;
    this.master.connect(ctx.destination);

    // Whine: detuned saw + sine harmonics through a lowpass.
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2600;
    lp.Q.value = 3;
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0;
    lp.connect(this.whineGain).connect(this.master);
    const partials: [OscillatorType, number, number][] = [
      ["sawtooth", 1, 0.18],
      ["sine", 2, 0.35],
      ["sine", 4.02, 0.12],
      ["triangle", 0.5, 0.25],
    ];
    for (const [type, mult, gain] of partials) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = 300 * mult;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(lp);
      o.start();
      this.oscs.push({ osc: o, mult });
    }

    // Cutting: looping white noise -> bandpass -> tooth-pass AM -> soft clip.
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    this.cutFilter = ctx.createBiquadFilter();
    this.cutFilter.type = "bandpass";
    this.cutFilter.frequency.value = 2200;
    this.cutFilter.Q.value = 0.9;
    const am = ctx.createGain();
    am.gain.value = 0.6;
    this.toothLfo = ctx.createOscillator();
    this.toothLfo.type = "square";
    this.toothLfo.frequency.value = 60;
    this.toothDepth = ctx.createGain();
    this.toothDepth.gain.value = 0.4;
    this.toothLfo.connect(this.toothDepth).connect(am.gain);
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * 2 - 1;
      curve[i] = Math.tanh(x * 3);
    }
    shaper.curve = curve;
    this.cutGain = ctx.createGain();
    this.cutGain.gain.value = 0;
    noise.connect(this.cutFilter).connect(am).connect(shaper).connect(this.cutGain).connect(this.master);
    noise.start();
    this.toothLfo.start();
  }

  /** rpm: actual spindle speed; cutRate: voxels removed per second; flutes for tooth-pass frequency. */
  update(rpm: number, cutRate: number, flutes: number, dt: number) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    const base = Math.max(20, (rpm / 60) * 2);
    for (const { osc, mult } of this.oscs) osc.frequency.setTargetAtTime(base * mult, t, 0.05);
    this.whineGain.gain.setTargetAtTime(rpm > 300 ? 0.35 + (rpm / 30000) * 0.35 : 0, t, 0.08);

    const target = Math.min(1, cutRate / 3000);
    this.cutLevel += (target - this.cutLevel) * Math.min(1, dt * 12);
    const jitter = 0.85 + Math.random() * 0.3;
    this.cutGain.gain.setTargetAtTime(this.cutLevel * 0.9 * jitter, t, 0.03);
    this.cutFilter.frequency.setTargetAtTime(1400 + rpm * 0.08 + Math.random() * 400, t, 0.05);
    // Real tooth-pass is hundreds of Hz; scale it down into the audible "grind" range.
    this.toothLfo.frequency.setTargetAtTime(Math.max(8, ((rpm / 60) * flutes) / 12), t, 0.05);
  }
}
