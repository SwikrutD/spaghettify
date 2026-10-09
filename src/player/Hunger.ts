import { HUNGER } from '../config';
import type { Player } from './Player';

export type RunPhase = 'playing' | 'evaporating' | 'over';

/**
 * Hawking evaporation as the fail state. Eating resets the hunger clock. After `graceTime` seconds without a
 * meal the hole's mass drains (ramping in); when it reaches the floor the hole evaporates for a short
 * moment and the run is over. `level` (0..1) drives the warning vignette and the dimming disk.
 */
export class Hunger {
  phase: RunPhase = 'playing';
  /** Disable the drain (tests). */
  enabled = true;
  /** Game seconds since the last meal. */
  idle = 0;
  /** Game seconds of this run. */
  runTime = 0;
  /** Raw hunger level 0..1 (the overlay smooths it). */
  level = 0;
  /** Highest mass of this run. The fail floor follows it. */
  peakMass: number;
  /** Called once when the evaporation finishes and the score screen should appear. */
  onEnd: (() => void) | null = null;
  private seenCount = 0;
  private endTimer = 0;

  constructor(private readonly player: Player) {
    this.peakMass = player.mass;
  }

  /** The run ends when mass falls to this. */
  get floorMass(): number {
    return Math.max(HUNGER.failMass, this.peakMass * HUNGER.failPeakFraction);
  }

  /**
   * After a hit: lower the floor (through the peak it follows) to at most `gap` of the current mass, so a hit
   * can never end the run by itself. Starvation still can, from the new floor.
   */
  forgiveHit(gap: number): void {
    const cap = (this.player.mass * gap) / HUNGER.failPeakFraction;
    this.peakMass = Math.min(this.peakMass, cap);
  }

  reset(): void {
    this.phase = 'playing';
    this.idle = 0;
    this.runTime = 0;
    this.level = 0;
    this.peakMass = this.player.mass;
    this.seenCount = this.player.eatenCount;
    this.endTimer = 0;
  }

  /** `dt` is game time (slowed by the tier-up set piece), `realDt` real time. */
  update(dt: number, realDt: number): void {
    const p = this.player;
    if (this.phase === 'over') return;

    if (this.phase === 'evaporating') {
      this.level = 1;
      p.mass = Math.max(this.floorMass * HUNGER.evaporateFloorFraction, p.mass * Math.exp(-HUNGER.evaporateRate * realDt));
      this.endTimer += realDt;
      if (this.endTimer >= HUNGER.evaporateTime) {
        this.phase = 'over';
        this.onEnd?.();
      }
      return;
    }

    this.runTime += dt;
    if (p.eatenCount !== this.seenCount) {
      this.seenCount = p.eatenCount;
      this.idle = 0;
    } else {
      this.idle += dt;
    }
    this.peakMass = Math.max(this.peakMass, p.mass);
    if (!this.enabled) {
      this.level = 0;
      return;
    }

    const floor = this.floorMass;
    const starving = this.idle > HUNGER.graceTime;
    if (starving) {
      const ramp = Math.min(1, (this.idle - HUNGER.graceTime) / HUNGER.rampTime);
      p.mass *= Math.exp(-HUNGER.decayRate * ramp * dt);
    }
    if (p.mass <= floor) {
      this.phase = 'evaporating';
      this.endTimer = 0;
      this.level = 1;
      return;
    }

    // Warning builds with time, then follows how much of the way to the floor the mass has drained.
    const timeLevel = 0.4 * smoothstep(HUNGER.warnTime, HUNGER.graceTime, this.idle);
    const massLevel = starving ? 0.4 + 0.6 * (1 - (p.mass - floor) / Math.max(1e-6, this.peakMass - floor)) : 0;
    this.level = Math.min(1, Math.max(timeLevel, massLevel));
  }
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
