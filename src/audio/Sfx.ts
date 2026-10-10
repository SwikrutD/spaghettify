import { AUDIO } from '../config';
import { noiseBuffer } from './Drone';

/** Synthesized one-shot effects. Each builds a few short-lived nodes that disconnect when they end. */
export class Sfx {
  private readonly noise: AudioBuffer;
  private lastEat = -1;

  constructor(private readonly ctx: AudioContext, private readonly dest: AudioNode) {
    this.noise = noiseBuffer(ctx, 1);
  }

  /** `rel` is prey radius over hole radius: small prey chirp high, big prey thud low. */
  eat(rel: number): void {
    const E = AUDIO.eat;
    const now = this.ctx.currentTime;
    if (now - this.lastEat < E.minGap) return;
    this.lastEat = now;
    const t = Math.min(1, Math.max(0, Math.log(rel / E.relSmall) / Math.log(E.relBig / E.relSmall)));
    const freq = E.freqSmall * Math.pow(E.freqBig / E.freqSmall, t);
    const dur = E.duration + (E.bigDuration - E.duration) * t;
    // A swallowed bloop: the pitch dives, with a soft noise puff for the bigger bites.
    this.tone('sine', freq * 1.6, freq * 0.6, dur, E.level);
    this.tone('triangle', freq * 0.5, freq * 0.25, dur * 1.2, E.level * 0.5 * t);
    if (t > 0.3) this.puff(dur, 600 - 300 * t, E.level * 0.6 * t);
  }

  grow(): void {
    const G = AUDIO.grow;
    G.freqs.forEach((f, i) => this.tone('sine', f, f, 0.35, G.level, i * G.noteGap, 0.01));
  }

  milestone(): void {
    const T = AUDIO.milestone;
    this.tone('sawtooth', T.sweepFrom, T.sweepTo, T.sweepTime, T.level * 0.5, 0, 0.05, 900);
    this.puff(T.sweepTime, 2000, T.level * 0.4, 0, 'highpass');
    T.chord.forEach((f, i) => {
      this.tone('sine', f, f, T.chordTime, T.level * 0.35, T.sweepTime * 0.8 + i * 0.04, 0.05);
      this.tone('triangle', f * 2.005, f * 2.005, T.chordTime * 0.7, T.level * 0.1, T.sweepTime * 0.8 + i * 0.04, 0.05);
    });
  }

  /** Hunger warning pulse. `urgency` 0..1 raises the pitch a little. */
  warning(urgency: number): void {
    const W = AUDIO.warning;
    const f = W.freq * (1 + 0.5 * urgency);
    this.tone('sine', f, f * 0.8, 0.22, W.level, 0, 0.01);
    this.tone('square', f * 0.5, f * 0.4, 0.18, W.level * 0.15, 0, 0.01, 500);
  }

  /** Collision: a low thud, a crunch and a short dissonant sting. */
  hit(): void {
    const H = AUDIO.hit;
    this.tone('sine', H.thumpFrom, H.thumpTo, H.thumpTime, H.level);
    this.puff(H.crunchTime, H.crunchCutoff, H.level * 0.6);
    this.tone('square', H.stingFreq, H.stingFreq * 0.94, H.stingTime, H.level * 0.12, 0.02, 0.01, 1800);
    this.tone('square', H.stingFreq * 1.06, H.stingFreq, H.stingTime, H.level * 0.1, 0.02, 0.01, 1800);
  }

  /** A hole eats a hole. `strength` 0..1 scales the level (a distant merger is quieter). */
  merger(strength: number): void {
    const M = AUDIO.merger;
    const level = M.level * Math.min(1, Math.max(0.15, strength));
    this.tone('sine', M.boomFrom, M.boomTo, M.boomTime, level);
    this.puff(M.boomTime, M.noiseCutoff, level * 0.5);
    this.tone('sine', M.waveFrom, M.waveTo, M.waveTime, level * 0.35, 0.05, 0.2);
  }

  /** The local hole is being swallowed: a long falling stretch. */
  swallowed(): void {
    const V = AUDIO.swallowed;
    this.tone('sawtooth', V.sweepFrom, V.sweepTo, V.time, V.level * 0.5, 0, 0.02, 1200);
    this.tone('sine', V.sweepFrom * 0.4, V.sweepTo * 0.6, V.time, V.level * 0.7);
  }

  evaporate(): void {
    const V = AUDIO.evaporate;
    this.tone('sawtooth', V.sweepFrom, V.sweepTo, V.time, V.level * 0.5, 0, 0.02, 1500);
    this.tone('sine', V.sweepFrom * 0.5, V.sweepTo, V.time, V.level * 0.7);
    this.puff(V.time, 3000, V.level * 0.5, 0, 'lowpass');
  }

  /** Enveloped oscillator with an exponential pitch glide. */
  private tone(
    type: OscillatorType,
    from: number,
    to: number,
    dur: number,
    level: number,
    delay = 0,
    attack = 0.005,
    cutoff = 0,
  ): void {
    if (level <= 0) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(level, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node: AudioNode = o;
    if (cutoff > 0) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = cutoff;
      node.connect(f);
      node = f;
    }
    node.connect(g).connect(this.dest);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
    o.onended = () => g.disconnect();
  }

  /** Filtered noise burst. */
  private puff(dur: number, cutoff: number, level: number, delay = 0, type: BiquadFilterType = 'lowpass'): void {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = Math.max(40, cutoff);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(level, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.dest);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
    src.onended = () => g.disconnect();
  }
}
