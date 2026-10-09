import { lerp } from './math.ts';

/** One mulberry32 step: a well mixed 32-bit value from a 32-bit state. */
function mix(t: number): number {
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

/**
 * The simulation's random stream (mulberry32). Every random choice in src/sim draws from the world's Rng,
 * never Math.random, so the same seed and inputs always give the same world.
 */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** Current state; a new Rng from it continues the same stream. */
  get state(): number {
    return this.s;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    return mix(this.s) / 4294967296;
  }

  /** Uniform in [min, max). */
  range(min: number, max: number): number {
    return lerp(min, max, this.next());
  }

  /** Log-uniform in [min, max) (as many small values per octave as big ones). */
  logUniform(min: number, max: number): number {
    return Math.exp(lerp(Math.log(min), Math.log(max), this.next()));
  }

  /** A random unsigned 32-bit integer (appearance seeds). */
  uint(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    return mix(this.s);
  }
}

/**
 * A fixed value in [0, 1) for channel `channel` of `seed`, with no stream state. The renderer derives a body's
 * look (colour, spin) from its seed this way, so every client draws the same body the same.
 */
export function hash01(seed: number, channel: number): number {
  return mix((seed + Math.imul(channel + 1, 0x9e3779b9)) >>> 0) / 4294967296;
}
