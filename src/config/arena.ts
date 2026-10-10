/**
 * The arena: one bounded disc where every size of body coexists, from dust grains to gas giants, so a pea and a
 * planet-eater share the same space. Radii are world units; mass = radius squared (see GROWTH). Class names are
 * generic classes of real bodies; sizes are ordered correctly but not to scale.
 *
 * Small matter (dust up to small moons) is far too plentiful to simulate one by one, so it is a procedural field:
 * each layer tiles the arena with square cells, each cell holds up to `grid` x `grid` grains placed by a hash of
 * the world seed, and the simulation only stores which grains have been eaten. Eaten grains grow back after a
 * while, once no hole is near. Big round bodies (dwarf planets and up) are individual bodies with a fixed
 * population per class; an eaten one respawns somewhere else in the arena, away from every hole.
 */

/** A [min, max] range. */
export type Range = readonly [number, number];

/** HSL colour ranges of one class. */
export interface PreyColor {
  hue: Range;
  sat: Range;
  light: Range;
}

export interface PreyClass {
  /** Player-facing name ("You ate a moon"). */
  name: string;
  /** Radius range, sampled log-uniformly. */
  radius: Range;
  color: PreyColor;
  /**
   * Drawn as a smooth sphere instead of a lumpy rock. True for bodies massive enough to pull themselves round
   * (dwarf planets and up); small moons and asteroids stay irregular, as real ones are.
   */
  round?: boolean;
}

/** A layer of the procedural field. Grains per cell average grid^2 x fill; density is that over cell^2. */
export interface FieldLayer extends PreyClass {
  /** Cell side in world units. */
  cell: number;
  /** Each cell is split into grid x grid slots with at most one grain each (so grains never overlap). At most 4. */
  grid: number;
  /** Chance that a slot holds a grain. */
  fill: number;
}

/** A class of individual bodies and how many of it the arena holds. */
export interface BodyClass extends PreyClass {
  count: number;
}

const DUST: PreyColor = { hue: [0.06, 0.1], sat: [0.05, 0.2], light: [0.35, 0.5] };
const ROCK: PreyColor = { hue: [0.04, 0.12], sat: [0.05, 0.35], light: [0.35, 0.6] };
const GREY: PreyColor = { hue: [0.05, 0.14], sat: [0.02, 0.12], light: [0.45, 0.65] };
const ICY: PreyColor = { hue: [0.5, 0.58], sat: [0.1, 0.3], light: [0.6, 0.78] };
const RUST: PreyColor = { hue: [0.02, 0.09], sat: [0.35, 0.6], light: [0.35, 0.55] };
const ICE_GIANT: PreyColor = { hue: [0.5, 0.6], sat: [0.45, 0.65], light: [0.5, 0.65] };
const GAS_GIANT: PreyColor = { hue: [0.07, 0.11], sat: [0.35, 0.55], light: [0.55, 0.7] };

export const ARENA = {
  /** Radius of the arena disc. A hole of radius 100 sees about a quarter of it; one of 200 most of it. */
  radius: 1200,
  /**
   * The edge is a dense gas wall. A hole within `edgeSoftness` of its own view distance of the edge is pushed back
   * (capped at `edgeMaxWidth` world units), harder the deeper it goes: `edgeStrength` times its steering
   * authority at the edge itself, so it cannot be crossed. Nothing gets more than `edgeHardLimit` of that soft
   * width past the edge.
   */
  edgeSoftness: 0.6,
  edgeMaxWidth: 300,
  edgeStrength: 1.6,
  edgeHardLimit: 0.3,
  /** Grains and bodies keep this far inside the edge (world units). */
  edgeMargin: 10,
  /**
   * Spatial grid over the bodies: levels of square cells (side in world units). A body goes into the first level
   * whose cell is at least twice its radius, else the last. Queries visit only the cells a circle can touch.
   */
  gridLevels: [64, 512],
  /** Bodies a hole cannot eat start this many of its view distances (radius alone) clear of it, where they can. */
  holeClearViews: 1.4,
  /**
   * Tries to place a respawn clear of every hole's view and of other bodies. With no place out of every hole's
   * sight the body waits, and tries again after respawnRetry seconds.
   */
  respawnTries: 24,
  respawnRetry: 2,
  /** The start of a life is kept clear of anything the hole cannot eat for this many view distances (radius alone). */
  spawnClearViews: 0.45,
} as const;

/**
 * Procedural small matter, smallest first. Density (grains per unit area) is grid^2 x fill / cell^2, chosen so a
 * hole sees a screenful of food at the size where a layer is food for it (a pea sees about 40 dust grains and
 * 9 pebbles; a hole of radius 10 about 10 asteroids). Grains bigger than a hole block it and the big ones pull it,
 * like bodies.
 */
export const FIELD = {
  layers: [
    { name: 'dust grain', radius: [0.05, 0.14], color: DUST, cell: 6, grid: 3, fill: 0.75 },
    { name: 'pebble', radius: [0.15, 0.4], color: ROCK, cell: 12, grid: 3, fill: 0.6 },
    { name: 'rock', radius: [0.45, 0.85], color: ROCK, cell: 28, grid: 3, fill: 0.6 },
    { name: 'boulder', radius: [0.9, 1.8], color: ROCK, cell: 50, grid: 3, fill: 0.6 },
    { name: 'asteroid', radius: [3, 7], color: GREY, cell: 120, grid: 3, fill: 0.6 },
    { name: 'small moon', radius: [6, 11], color: GREY, cell: 220, grid: 3, fill: 0.5 },
  ] as readonly FieldLayer[],
  /** Seconds before an eaten cell can grow back (it waits longer while a hole is near). */
  regrowTime: [20, 40] as Range,
  /** A cell only grows back once every hole is this many of its view distances (radius alone) away. */
  regrowClearViews: 1.8,
  /** Seconds between checks of a waiting cell that could not grow back yet. */
  regrowRetry: 3,
  /** Waiting cells checked per step at most (the rest wait for later steps). */
  regrowChecksPerStep: 400,
  /** Pooled infalls of eaten grains (a full pool reuses the oldest). */
  infallPoolSize: 96,
} as const;

/** Individual round bodies, scattered across the arena with a fixed population per class. */
export const BODIES = {
  classes: [
    { name: 'dwarf planet', radius: [11, 20], color: ICY, round: true, count: 160 },
    { name: 'moon', radius: [20, 32], color: GREY, round: true, count: 70 },
    { name: 'rocky planet', radius: [36, 60], color: RUST, round: true, count: 18 },
    { name: 'ice giant', radius: [80, 120], color: ICE_GIANT, round: true, count: 6 },
    { name: 'gas giant', radius: [150, 220], color: GAS_GIANT, round: true, count: 3 },
  ] as readonly BodyClass[],
} as const;

/**
 * Size milestones: the moment a hole can swallow every member of a class (its largest radius is below the
 * edible ratio of the hole's radius). Crossing one plays the set piece (banner, flash, punch, sound); nothing in
 * the arena changes. The first is the start of every life. `unlocks` names a class in FIELD or BODIES.
 */
export const MILESTONES: readonly { title: string; unlocks: string | null }[] = [
  { title: 'Dust eater', unlocks: null },
  { title: 'Rock eater', unlocks: 'rock' },
  { title: 'Boulder eater', unlocks: 'boulder' },
  { title: 'Asteroid eater', unlocks: 'asteroid' },
  { title: 'Dwarf planet eater', unlocks: 'dwarf planet' },
  { title: 'Moon eater', unlocks: 'moon' },
  { title: 'Planet eater', unlocks: 'rocky planet' },
  { title: 'Ice giant eater', unlocks: 'ice giant' },
  { title: 'Gas giant eater', unlocks: 'gas giant' },
];

/** The set piece when a milestone is crossed. Times are real seconds. */
export const MILESTONE_FX = {
  /** Extra camera pull-back at the peak, as a fraction of the distance. */
  punchZoom: 0.3,
  /** Seconds for the pull-back to reach its peak, then to settle. */
  punchRise: 0.3,
  punchFall: 1.6,
  /** White flash: peak opacity and decay time constant. */
  flashPeak: 0.45,
  flashDecay: 0.22,
  /** How long the banner stays up. */
  bannerTime: 3,
} as const;
