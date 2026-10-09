import { TIER_UP } from '../config';
import { smoothstep } from '../sim/math.ts';

/**
 * The presentation half of a tier-up: a camera pull-back punch and a white flash, on real time. The sim owns
 * the tier itself and the slow-motion dip (World.timeScale); this starts on the local hole's 'tier' event.
 */
export class TierSetPiece {
  /** Real seconds since the last tier-up (infinite before the first). */
  private since = Infinity;

  /** 0..1 camera pull-back envelope: quick rise, slow settle. */
  get punch(): number {
    const t = this.since;
    if (t < TIER_UP.punchRise) return smoothstep(0, TIER_UP.punchRise, t);
    return 1 - smoothstep(0, TIER_UP.punchFall, t - TIER_UP.punchRise);
  }

  /** 0..1 white flash opacity factor. */
  get flash(): number {
    if (!Number.isFinite(this.since)) return 0;
    return smoothstep(0, 0.03, this.since) * Math.exp(-this.since / TIER_UP.flashDecay);
  }

  start(): void {
    this.since = 0;
  }

  /** Call before this frame's events are handled, so a tier-up in them starts the envelopes at zero. */
  update(realDt: number): void {
    this.since += realDt;
  }

  reset(): void {
    this.since = Infinity;
  }
}
