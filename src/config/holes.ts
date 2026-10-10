/**
 * Holes against holes, and the bot holes that fill the arena. Radii are world units, times are game seconds.
 * A hole's mass is on the hole curve (GROWTH.radiusExponent), so mass ratios are the radius ratio to the 2.5.
 */

/** Hole vs hole: who eats whom, and what a merger looks like. */
export const HOLES = {
  /** A hole whose radius is at least this multiple of another's can swallow it. */
  eatRatio: 1.15,
  /** ...once the smaller hole's centre is within this fraction of the bigger one's radius (the bigger one covers it). */
  coverFraction: 0.9,
  /** Fraction of the eaten hole's mass the eater gains. The rest is radiated away as gravitational waves. */
  massTransfer: 0.8,
  /** Seconds the eaten hole spends spaghettifying into the eater before its life is over. */
  infallTime: 1.2,
  /** How far into a swallow the eaten hole is drawn: stretch along the line to the eater, swirl (radians), and the infall curve. */
  maxStretch: 5,
  swirl: 1.6,
  accelPower: 1.8,
  /** Holes too close in size (under eatRatio) bump when their cores overlap: contact at (radius sum) x this. */
  bumpOverlap: 0.9,
  /** Knockback of a hole bump as a multiple of each hole's own top speed, and the stun (seconds). */
  bumpKnock: 1.3,
  bumpStun: 0.25,
  /** Seconds after (re)spawning in a running arena when a hole can neither eat nor be eaten by a hole (its disk blinks). */
  spawnProtection: 3,
  /** The merger: a gravitational wave ripple spreading from the eater (render; see MergerRipple). */
  ripple: {
    /** Seconds, and how far it spreads in eater radii (one ring by the end, a second one trailing it). */
    time: 1.6,
    reach: 9,
    /** Starting ring width in eater radii, and the HDR intensity. */
    width: 0.8,
    intensity: 1.4,
  },
  /** Camera shake (fraction of the distance) and flash opacity when the local hole eats or is eaten, scaled by the size ratio. */
  mergerShake: 0.03,
  mergerFlash: 0.35,
  /** Another hole's merger shakes the screen when it is within this many view distances of the camera. */
  mergerShakeViews: 1.5,
} as const;

/** Bot holes: wander and feed, chase smaller holes, flee bigger ones. Steered only through `hole.input`. */
export const BOTS = {
  /** Bot holes in an arena (the player makes it about twelve). */
  count: 11,
  /** Radius of a bot present at the start of an arena (log-uniform), so the arena looks lived in. */
  initialRadius: [0.5, 9] as readonly [number, number],
  /** Radius of a bot that respawns after being eaten, and seconds before it does. */
  respawnRadius: [0.5, 2.5] as readonly [number, number],
  respawnDelay: [2, 6] as readonly [number, number],
  /**
   * More bots than the target (players joined a room): a bot whose life ends leaves instead of coming back, and while
   * there are still too many, every retireAfter seconds the smallest bot no player could see (none within
   * retireClearViews of their view distance, past the edge of any screen) leaves quietly.
   */
  retireAfter: 8,
  retireClearViews: 2.6,
  /** Per-bot character, drawn at each spawn (uniform in these ranges). */
  temperament: {
    /** 0..1: how readily it hunts smaller holes and how far away it notices them. */
    aggression: [0.1, 0.95] as readonly [number, number],
    /** 0..1: how early it runs from bigger holes. */
    caution: [0.2, 0.9] as readonly [number, number],
    /** Seconds between decisions (its reaction time; a decision is jittered by 30 percent). */
    reaction: [0.18, 0.55] as readonly [number, number],
    /** Radians of random steering error (a slowly drifting offset). */
    wobble: [0, 0.3] as readonly [number, number],
    /** Fraction of full input a bot ever uses (so some are a little slower). */
    throttle: [0.82, 1] as readonly [number, number],
  },
  /** Food and obstacles are looked for this many view distances out. */
  sightViews: 0.9,
  /** Prey holes are noticed out to view x (huntBase + huntPerAggression x aggression), a bigger hole to its radius x (fearBase + fearPerCaution x caution) + this many seconds of its travel. */
  huntBase: 1.5,
  huntPerAggression: 4,
  fearBase: 3,
  fearPerCaution: 4,
  fearSeconds: 1.2,
  /** A hole is only worth hunting if its mass is at least this fraction of the bot's own (or it is close). */
  huntMinMassFraction: 0.02,
  /** Hunting wants the bot at least this much bigger (radius) than the target, over HOLES.eatRatio, so it does not give chase at the edge. */
  huntMargin: 1.04,
  /** Prey holes are worth this much more than a meal of the same mass, times 0.5 + aggression. */
  huntBonus: 2.5,
  /**
   * Inedible bodies are steered around: a body whose distance from the path ahead is under (hole radius + body
   * radius) x avoidClearance bends the path; the path is lookaheadSeconds (plus its reaction time) of travel long.
   * avoidMargin is the search margin around that path, in radii.
   */
  avoidClearance: 1.5,
  avoidMargin: 1.6,
  lookaheadSeconds: 0.9,
  /** A meal within (body radius) x this plus two hole radii of something the bot cannot eat is left alone: it is in the body's pull. */
  mealClearance: 1.8,
  /** Weights of the steering parts. */
  weights: { flee: 3.5, avoid: 5, wall: 2.5, chase: 1.6, food: 1.2, wander: 0.35 },
  /** Wander: heading drift (radians per second) and pull toward the centre when far out. */
  wanderTurn: 0.9,
} as const;

/** Generated names for bot holes (and players without a nickname): on-theme, short, never food. */
export const HOLE_NAMES = {
  first: [
    'Silent', 'Dark', 'Hollow', 'Distant', 'Ancient', 'Quiet', 'Rogue', 'Wandering', 'Lone', 'Pale', 'Vast', 'Cold',
    'Slow', 'Bright', 'Deep', 'Fading', 'Veiled', 'Restless', 'Spinning', 'Crimson',
  ],
  second: [
    'Quasar', 'Pulsar', 'Nebula', 'Horizon', 'Singularity', 'Void', 'Umbra', 'Comet', 'Orbit', 'Eclipse', 'Photon',
    'Magnetar', 'Cosmos', 'Aphelion', 'Perihelion', 'Redshift', 'Parallax', 'Zenith', 'Corona', 'Meteor',
  ],
  /** Real names to draw on now and then (stars, constellations, physicists). */
  proper: [
    'Sagittarius', 'Cygnus', 'Hawking', 'Penrose', 'Kerr', 'Schwarzschild', 'Chandra', 'Betelgeuse', 'Rigel', 'Vega',
    'Altair', 'Sirius', 'Antares', 'Orion', 'Lyra', 'Draco', 'Andromeda', 'Carina', 'Perseus', 'Cassiopeia',
  ],
  /** Chance a name is a proper name with a number ("Kerr-7") instead of two words. */
  properChance: 0.3,
} as const;
