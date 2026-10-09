/**
 * Size tiers. A tier starts when the player's mass reaches `minMass` (mass = radius squared, see GROWTH).
 * Each tier has its own absolute prey table, entity budget and camera scale. Radii are in world units.
 * The names are generic classes of real bodies (a moon, a dwarf planet); sizes are ordered correctly but not to scale.
 */

/** A [min, max] range. */
export type Range = readonly [number, number];

/** HSL colour ranges of one prey class. */
export interface PreyColor {
  hue: Range;
  sat: Range;
  light: Range;
}

export interface PreyClass {
  /** Player-facing name, used for "biggest object eaten". */
  name: string;
  /** Radius range, sampled log-uniformly. */
  radius: Range;
  /** Relative spawn weight within the tier. */
  weight: number;
  color: PreyColor;
}

export interface Tier {
  /** Player-facing name, shown at the tier-up. */
  title: string;
  /** Mass at which this tier begins. */
  minMass: number;
  /** Entity budget: how many prey are live at once. */
  count: number;
  /** Camera distance multiplier. The view pulls back to this when the tier begins. */
  cameraScale: number;
  classes: readonly PreyClass[];
  comets: CometTable;
}

/**
 * Comets of one tier: the roaming hazard. A comet the hole cannot eat knocks it back; once the hole is big
 * enough it is a fast meal. Real comet nuclei are about asteroid-sized, so the radii stay in that range.
 */
export interface CometTable {
  /** Nucleus radius range, sampled log-uniformly. */
  radius: Range;
  /** Speed in camera distances per second (the hole's top speed is about 0.8). */
  speed: Range;
  /** Seconds between comets, and before the first one of the tier. */
  interval: Range;
  firstDelay: number;
}

const DUST: PreyColor = { hue: [0.06, 0.1], sat: [0.05, 0.2], light: [0.35, 0.5] };
const ROCK: PreyColor = { hue: [0.04, 0.12], sat: [0.05, 0.35], light: [0.35, 0.6] };
const GREY: PreyColor = { hue: [0.05, 0.14], sat: [0.02, 0.12], light: [0.45, 0.65] };
const ICY: PreyColor = { hue: [0.5, 0.58], sat: [0.1, 0.3], light: [0.6, 0.78] };
const RUST: PreyColor = { hue: [0.02, 0.09], sat: [0.35, 0.6], light: [0.35, 0.55] };
const ICE_GIANT: PreyColor = { hue: [0.5, 0.6], sat: [0.45, 0.65], light: [0.5, 0.65] };
const GAS_GIANT: PreyColor = { hue: [0.07, 0.11], sat: [0.35, 0.55], light: [0.55, 0.7] };

export const TIERS: readonly Tier[] = [
  {
    title: 'Debris',
    minMass: 0,
    count: 80,
    cameraScale: 1,
    classes: [
      { name: 'dust grain', radius: [0.05, 0.14], weight: 3, color: DUST },
      { name: 'pebble', radius: [0.15, 0.4], weight: 4, color: ROCK },
      { name: 'rock', radius: [0.45, 0.85], weight: 3, color: ROCK },
      { name: 'boulder', radius: [0.9, 1.8], weight: 1.5, color: ROCK },
    ],
    comets: { radius: [0.8, 1.4], speed: [0.45, 0.6], interval: [11, 18], firstDelay: 12 },
  },
  {
    title: 'Asteroids and moons',
    minMass: 9,
    count: 70,
    cameraScale: 1.35,
    classes: [
      { name: 'rock', radius: [0.5, 1.2], weight: 2.5, color: ROCK },
      { name: 'boulder', radius: [1.2, 3], weight: 3, color: ROCK },
      { name: 'asteroid', radius: [3, 7], weight: 3.5, color: GREY },
      { name: 'small moon', radius: [6, 11], weight: 2, color: GREY },
      { name: 'dwarf planet', radius: [11, 18], weight: 1.2, color: ICY },
      { name: 'moon', radius: [18, 26], weight: 0.5, color: GREY },
    ],
    comets: { radius: [4, 9], speed: [0.5, 0.7], interval: [9, 15], firstDelay: 6 },
  },
  {
    title: 'Planets',
    minMass: 400,
    count: 60,
    cameraScale: 1.8,
    classes: [
      { name: 'asteroid', radius: [4, 9], weight: 1.5, color: GREY },
      { name: 'small moon', radius: [6, 12], weight: 2.5, color: GREY },
      { name: 'dwarf planet', radius: [12, 20], weight: 2, color: ICY },
      { name: 'moon', radius: [20, 32], weight: 2.5, color: GREY },
      { name: 'rocky planet', radius: [36, 60], weight: 2.5, color: RUST },
      { name: 'ice giant', radius: [80, 120], weight: 1, color: ICE_GIANT },
      { name: 'gas giant', radius: [150, 220], weight: 0.7, color: GAS_GIANT },
    ],
    comets: { radius: [6, 14], speed: [0.55, 0.75], interval: [8, 14], firstDelay: 6 },
  },
];

/** Pool size: the largest entity budget of any tier. */
export const PREY_POOL_SIZE = Math.max(...TIERS.map((t) => t.count));

/** Index of the highest tier whose threshold the mass has reached. */
export function tierIndexForMass(mass: number): number {
  let index = 0;
  for (let i = 1; i < TIERS.length; i++) if (mass >= TIERS[i].minMass) index = i;
  return index;
}

/** Smallest prey radius in the tier's table. */
export function tierMinRadius(tier: Tier): number {
  return Math.min(...tier.classes.map((c) => c.radius[0]));
}

/** The set piece when a tier begins. Times are real seconds. */
export const TIER_UP = {
  /** Extra camera pull-back at the peak, as a fraction of the distance. */
  punchZoom: 0.3,
  /** Seconds for the pull-back to reach its peak, then to settle. */
  punchRise: 0.3,
  punchFall: 1.6,
  /** How quickly the camera moves to the new tier's scale (1/s). */
  pullRate: 1.6,
  /** Slow motion: game speed at the lowest point, and how long it lasts. */
  slowmoScale: 0.25,
  slowmoTime: 0.9,
  /** White flash: peak opacity and decay time constant. */
  flashPeak: 0.55,
  flashDecay: 0.22,
  /** How long the tier banner stays up. */
  bannerTime: 3,
} as const;
