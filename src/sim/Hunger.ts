import { HUNGER } from '../config/index.ts';
import { smoothstep } from './math.ts';
import type { Hole } from './Hole.ts';

export type RunPhase = 'playing' | 'evaporating' | 'over';

/**
 * Hawking evaporation as the fail state of one hole. Eating resets the hunger clock. After `graceTime` seconds
 * without a meal the hole's mass drains (ramping in); when it reaches the floor the hole evaporates for a short
 * moment and its life is over. `level` (0..1) drives the warning vignette and the dimming disk.
 */
export class Hunger {
  phase: RunPhase = 'playing';
  /** Disable the drain (tests). */
  enabled = true;
  /** Game seconds since the last meal. */
  idle = 0;
  /** Game seconds of this life. */
  runTime = 0;
  /** Raw hunger level 0..1 (the overlay smooths it). */
  level = 0;
  /** Highest mass of this life. The fail floor follows it. */
  peakMass: number;
  private readonly hole: Hole;
  private seenCount = 0;
  private endTimer = 0;

  constructor(hole: Hole) {
    this.hole = hole;
    this.peakMass = hole.mass;
  }

  /** The life ends when mass falls to this. */
  get floorMass(): number {
    return Math.max(HUNGER.failMass, this.peakMass * HUNGER.failPeakFraction);
  }

  /**
   * After a hit: lower the floor (through the peak it follows) to at most `gap` of the current mass, so a hit
   * can never end the life by itself. Starvation still can, from the new floor.
   */
  forgiveHit(gap: number): void {
    const cap = (this.hole.mass * gap) / HUNGER.failPeakFraction;
    this.peakMass = Math.min(this.peakMass, cap);
  }

  reset(): void {
    this.phase = 'playing';
    this.idle = 0;
    this.runTime = 0;
    this.level = 0;
    this.peakMass = this.hole.mass;
    this.seenCount = this.hole.eatenCount;
    this.endTimer = 0;
  }

  /** `dt` is game time (slowed by the tier-up set piece), `realDt` real time (the final evaporation runs on it). */
  update(dt: number, realDt: number): void {
    const hole = this.hole;
    if (this.phase === 'over') return;

    if (this.phase === 'evaporating') {
      this.level = 1;
      hole.mass = Math.max(this.floorMass * HUNGER.evaporateFloorFraction, hole.mass * Math.exp(-HUNGER.evaporateRate * realDt));
      this.endTimer += realDt;
      if (this.endTimer >= HUNGER.evaporateTime) this.phase = 'over';
      return;
    }

    this.runTime += dt;
    if (hole.eatenCount !== this.seenCount) {
      this.seenCount = hole.eatenCount;
      this.idle = 0;
    } else {
      this.idle += dt;
    }
    this.peakMass = Math.max(this.peakMass, hole.mass);
    if (!this.enabled) {
      this.level = 0;
      return;
    }

    const floor = this.floorMass;
    const starving = this.idle > HUNGER.graceTime;
    if (starving) {
      const ramp = Math.min(1, (this.idle - HUNGER.graceTime) / HUNGER.rampTime);
      hole.mass *= Math.exp(-HUNGER.decayRate * ramp * dt);
    }
    if (hole.mass <= floor) {
      this.phase = 'evaporating';
      this.endTimer = 0;
      this.level = 1;
      return;
    }

    // Warning builds with time, then follows how much of the way to the floor the mass has drained.
    const timeLevel = 0.4 * smoothstep(HUNGER.warnTime, HUNGER.graceTime, this.idle);
    const massLevel = starving ? 0.4 + 0.6 * (1 - (hole.mass - floor) / Math.max(1e-6, this.peakMass - floor)) : 0;
    this.level = Math.min(1, Math.max(timeLevel, massLevel));
  }
}
