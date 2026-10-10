import { MILESTONE_FX } from '../config';
import { smoothstep } from '../sim/math.ts';

/**
 * The presentation of a size milestone: a camera pull-back punch and a white flash, on real time. The sim only
 * reports the milestone (a 'milestone' event for the local hole); the arena carries on unchanged and nothing slows
 * down, since other holes share it.
 */
export class MilestoneSetPiece {
  /** Real seconds since the last milestone (infinite before the first). */
  private since = Infinity;

  /** 0..1 camera pull-back envelope: quick rise, slow settle. */
  get punch(): number {
    const t = this.since;
    if (t < MILESTONE_FX.punchRise) return smoothstep(0, MILESTONE_FX.punchRise, t);
    return 1 - smoothstep(0, MILESTONE_FX.punchFall, t - MILESTONE_FX.punchRise);
  }

  /** 0..1 white flash opacity factor. */
  get flash(): number {
    if (!Number.isFinite(this.since)) return 0;
    return smoothstep(0, 0.03, this.since) * Math.exp(-this.since / MILESTONE_FX.flashDecay);
  }

  start(): void {
    this.since = 0;
  }

  /** Call before this frame's events are handled, so a milestone in them starts the envelopes at zero. */
  update(realDt: number): void {
    this.since += realDt;
  }

  reset(): void {
    this.since = Infinity;
  }
}
