import { HUNGER } from '../config/index.ts';
import { smoothstep } from './math.ts';
import type { Hole } from './Hole.ts';

export type RunPhase = 'playing' | 'evaporating' | 'over';

/** Fraction of a hole's mass Hawking radiation takes per second at this radius, fed or not: bigger holes decay faster. */
export function hawkingRate(radius: number): number {
  if (radius < HUNGER.hawkingMinRadius) return 0;
  return HUNGER.hawkingRate * Math.pow(radius / HUNGER.hawkingRadius, HUNGER.hawkingExponent);
}

/**
 * Hawking evaporation, one hole's fail state. Every hole above HUNGER.hawkingMinRadius loses mass all the time, more
 * the bigger it is (so a leader cannot camp forever). Eating resets the hunger clock; after `graceTime` seconds
 * without a meal a starvation drain ramps in on top. When the mass falls to `floorMass` (half the start mass: only
 * a tiny starving hole gets there) it evaporates for a short moment and its life is over. `level` (0..1) drives the
 * warning vignette and the dimming disk.
 */
export class Hunger {
  phase: RunPhase = 'playing';
  /** Disable all decay (tests). */
  enabled = true;
  /** Seconds since the last meal. */
  idle = 0;
  /** Seconds of this life. */
  runTime = 0;
  /** Raw hunger level 0..1 (the overlay smooths it). */
  level = 0;
  private readonly hole: Hole;
  private seenCount = 0;
  private endTimer = 0;

  constructor(hole: Hole) {
    this.hole = hole;
  }

  /** The life ends when the mass falls to this. */
  get floorMass(): number {
    return HUNGER.evaporateMass;
  }

  reset(): void {
    this.phase = 'playing';
    this.idle = 0;
    this.runTime = 0;
    this.level = 0;
    this.seenCount = this.hole.eatenCount;
    this.endTimer = 0;
  }

  update(dt: number): void {
    const hole = this.hole;
    if (this.phase === 'over') return;

    if (this.phase === 'evaporating') {
      this.level = 1;
      hole.mass = Math.max(this.floorMass * HUNGER.evaporateFloorFraction, hole.mass * Math.exp(-HUNGER.evaporateRate * dt));
      this.endTimer += dt;
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
    if (!this.enabled) {
      this.level = 0;
      return;
    }

    const floor = this.floorMass;
    const starving = this.idle > HUNGER.graceTime;
    const ramp = starving ? Math.min(1, (this.idle - HUNGER.graceTime) / HUNGER.rampTime) : 0;
    hole.mass *= Math.exp(-(hawkingRate(hole.radius) + HUNGER.starveRate * ramp) * dt);
    if (hole.mass <= floor) {
      this.phase = 'evaporating';
      this.endTimer = 0;
      this.level = 1;
      return;
    }

    // Warning builds with time, then climbs with time spent starving, or sooner as the mass nears the floor.
    const timeLevel = 0.4 * smoothstep(HUNGER.warnTime, HUNGER.graceTime, this.idle);
    let starveLevel = 0;
    if (starving) {
      const progress = Math.min(1, (this.idle - HUNGER.graceTime) / HUNGER.levelRampTime);
      const nearFloor = Math.min(1, Math.max(0, 1 - (hole.mass - floor) / (floor * 2)));
      starveLevel = 0.4 + 0.6 * Math.max(progress, nearFloor);
    }
    this.level = Math.min(1, Math.max(timeLevel, starveLevel));
  }
}
