import { AUDIO, PLAYER } from '../config';

const D = AUDIO.drone;

/**
 * Ambient drone: two detuned saws and a sub sine through a lowpass, a dark noise rumble and a dissonant
 * voice. Size lowers the pitch and closes the filter; hunger adds detune, tremolo and the dissonant voice.
 */
export class Drone {
  private readonly out: GainNode;
  private readonly saws: OscillatorNode[] = [];
  private readonly sub: OscillatorNode;
  private readonly dissonant: OscillatorNode;
  private readonly dissonantGain: GainNode;
  private readonly filter: BiquadFilterNode;
  private readonly tremolo: OscillatorNode;
  private readonly tremoloGain: GainNode;
  private readonly tremoloBus: GainNode;

  constructor(private readonly ctx: AudioContext, dest: AudioNode) {
    this.out = ctx.createGain();
    this.out.connect(dest);

    // Tremolo: the bus gain is (1 - depth/2) plus an LFO of +-depth/2.
    this.tremoloBus = ctx.createGain();
    this.tremoloBus.gain.value = 1;
    this.tremoloBus.connect(this.out);
    this.tremolo = ctx.createOscillator();
    this.tremolo.frequency.value = D.tremoloMin;
    this.tremoloGain = ctx.createGain();
    this.tremoloGain.gain.value = 0;
    this.tremolo.connect(this.tremoloGain).connect(this.tremoloBus.gain);
    this.tremolo.start();

    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 0.8;
    this.filter.frequency.value = D.cutoffSmall;
    this.filter.connect(this.tremoloBus);

    for (const sign of [-1, 1]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = D.baseFreq;
      o.detune.value = sign * D.detune;
      const g = ctx.createGain();
      g.gain.value = D.sawLevel;
      o.connect(g).connect(this.filter);
      o.start();
      this.saws.push(o);
    }

    this.sub = ctx.createOscillator();
    this.sub.type = 'sine';
    this.sub.frequency.value = D.baseFreq / 2;
    const subGain = ctx.createGain();
    subGain.gain.value = D.subLevel;
    this.sub.connect(subGain).connect(this.tremoloBus);
    this.sub.start();

    this.dissonant = ctx.createOscillator();
    this.dissonant.type = 'triangle';
    this.dissonant.frequency.value = D.baseFreq * D.dissonantRatio;
    this.dissonantGain = ctx.createGain();
    this.dissonantGain.gain.value = 0;
    this.dissonant.connect(this.dissonantGain).connect(this.filter);
    this.dissonant.start();

    // Rumble: looped noise, lowpassed hard.
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(ctx, 2);
    noise.loop = true;
    const rumbleFilter = ctx.createBiquadFilter();
    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.value = 160;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = D.rumbleLevel;
    noise.connect(rumbleFilter).connect(rumbleGain).connect(this.tremoloBus);
    noise.start();

    this.out.gain.value = 0;
    this.fadeIn();
  }

  fadeIn(): void {
    const g = this.out.gain;
    g.cancelScheduledValues(this.ctx.currentTime);
    g.setTargetAtTime(1, this.ctx.currentTime, D.fadeIn / 3);
  }

  fadeOut(): void {
    const g = this.out.gain;
    g.cancelScheduledValues(this.ctx.currentTime);
    g.setTargetAtTime(0, this.ctx.currentTime, D.fadeOut / 3);
  }

  /** `hunger` is 0..1. */
  update(radius: number, hunger: number): void {
    const t = this.ctx.currentTime;
    const k = D.follow / 3;
    const sizeRatio = Math.max(1, radius / PLAYER.startRadius);
    const freq = Math.max(D.minFreq, D.baseFreq * Math.pow(sizeRatio, -D.pitchExponent));
    // 0 at the start size, 1 at about 40x the radius.
    const bigness = Math.min(1, Math.log(sizeRatio) / Math.log(40));
    const cutoff = (D.cutoffSmall + (D.cutoffBig - D.cutoffSmall) * bigness) * (1 - (1 - D.hungerCutoffScale) * hunger);

    for (let i = 0; i < this.saws.length; i++) {
      this.saws[i].frequency.setTargetAtTime(freq, t, k);
      this.saws[i].detune.setTargetAtTime((i === 0 ? -1 : 1) * (D.detune + D.hungerDetune * hunger), t, k);
    }
    this.sub.frequency.setTargetAtTime(freq / 2, t, k);
    this.dissonant.frequency.setTargetAtTime(freq * D.dissonantRatio, t, k);
    this.dissonantGain.gain.setTargetAtTime(D.dissonantLevel * hunger * hunger, t, k);
    this.filter.frequency.setTargetAtTime(cutoff, t, k);
    this.tremolo.frequency.setTargetAtTime(D.tremoloMin + (D.tremoloMax - D.tremoloMin) * hunger, t, k);
    const depth = D.tremoloDepth * hunger;
    this.tremoloGain.gain.setTargetAtTime(depth / 2, t, k);
    this.tremoloBus.gain.setTargetAtTime(1 - depth / 2, t, k);
  }
}

export function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}
