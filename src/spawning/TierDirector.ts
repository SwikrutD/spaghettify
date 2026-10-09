import { TIERS, TIER_UP, tierIndexForMass, type Tier } from '../config';

/**
 * Tracks which size tier the player is in (it only ever goes up) and runs the short set piece when a
 * new one begins: a camera pull-back punch, a slow-motion dip and a white flash. All times are real seconds.
 */
export class TierDirector {
  index = 0;
  /** Called once when a new tier begins, with the new tier and its index. */
  onTierUp: ((tier: Tier, index: number) => void) | null = null;
  /** Seconds since the last tier-up (infinite before the first). */
  private since = Infinity;

  get tier(): Tier {
    return TIERS[this.index];
  }

  /** Game speed multiplier: dips to slowmoScale right after a tier-up. */
  get timeScale(): number {
    const t = this.since;
    if (t >= TIER_UP.slowmoTime) return 1;
    const dip = smoothstep(0, 0.08, t) * (1 - smoothstep(TIER_UP.slowmoTime * 0.4, TIER_UP.slowmoTime, t));
    return 1 - (1 - TIER_UP.slowmoScale) * dip;
  }

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

  update(realDt: number, mass: number): void {
    this.since += realDt;
    const next = tierIndexForMass(mass);
    if (next > this.index) {
      this.index = next;
      this.since = 0;
      this.onTierUp?.(this.tier, next);
    }
  }
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
