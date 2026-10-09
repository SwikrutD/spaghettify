/** All tunable numbers live here. Game logic must not hard-code these. */

export const PLAYER = {
  /** Starting radius in world units ("pea-sized"). */
  startRadius: 0.5,
  /** Top speed in world units per second. */
  maxSpeed: 9,
  /** How quickly velocity chases the desired velocity (1/s). Lower = more drifty. */
  responsiveness: 3.2,
  /** Passive drag applied every frame (1/s). */
  drag: 0.4,
} as const;

export const GROWTH = {
  /** Mass of an object of radius r is massDensity * r^3 (the player starts with the same rule). */
  massDensity: 1,
  /** Fraction of a prey object's mass that the player absorbs. */
  absorbEfficiency: 1,
  /** radius = startRadius * (mass / startMass) ^ radiusExponent. 1/3 would conserve volume; higher grows faster. */
  radiusExponent: 0.5,
  /** How quickly the visible radius chases the radius implied by mass (1/s). */
  radiusSmoothing: 5,
} as const;

export const PREY = {
  /** Fixed pool size (entity budget). Placeholder until tiers arrive in M5. */
  count: 60,
  /** Prey radius range as a multiple of the player radius at spawn time. Sampled log-uniformly. */
  sizeRelMin: 0.2,
  sizeRelMax: 2.2,
  /** Player can eat an object whose radius is below this fraction of its own radius. */
  edibleRatio: 0.95,
  /** Eaten when the distance to the player is below playerRadius + preyRadius * eatReach. */
  eatReach: 0.25,
  /** Initial fill: spawn distance range in player radii. */
  initialInner: 4,
  initialOuter: 32,
  /** Respawn ring (player radii), just beyond the visible area. */
  respawnInner: 26,
  respawnOuter: 34,
  /** Objects farther than this many player radii are recycled. */
  despawnDistance: 44,
  /** Off-screen prey smaller than this fraction of the minimum spawn size (relative to the player) are recycled. */
  staleRatio: 0.6,
  /** Max drift speed in player radii per second. */
  driftSpeed: 0.12,
  /** Max spin speed in rad/s. */
  spinSpeed: 0.8,
  /** Seconds to scale in after spawning. */
  appearTime: 0.5,
  /** Seconds for an eaten object to shrink into the hole. */
  eatTime: 0.22,
  /** Rock surface roughness (fraction of radius) and mesh detail. */
  roughness: 0.18,
  meshDetail: 2,
  /** Colour palette (HSL) for prey. */
  hueMin: 0.04,
  hueMax: 0.12,
  satMin: 0.05,
  satMax: 0.35,
  lightMin: 0.35,
  lightMax: 0.6,
} as const;

export const LIGHTING = {
  ambient: 0.35,
  key: 2.2,
  keyColor: 0xfff1e0,
  /** Direction the key light comes from. */
  keyPosition: [-0.5, 1, 0.4],
} as const;

export const INPUT = {
  /** Pointer distance from screen centre (fraction of the shorter screen side) that gives full speed. */
  mouseFullSpeedRadius: 0.3,
  /** Pointer offset below this fraction gives no movement. */
  mouseDeadzone: 0.02,
} as const;

export const CAMERA = {
  /** Angle of the view direction below the horizon, in degrees (90 = straight down). */
  tiltDegrees: 58,
  /** Distance from the player, as a multiple of player radius. */
  distancePerRadius: 22,
  fov: 45,
  near: 0.1,
  far: 2000,
  /** Camera follow smoothing (1/s). */
  followSmoothing: 6,
} as const;

export const BLOOM = {
  strength: 0.3,
  radius: 0.2,
  threshold: 0.9,
} as const;

export const RENDER = {
  maxPixelRatio: 2,
  clearColor: 0x000000,
  /** Frame time cap so a long frame cannot teleport the player. */
  maxFrameDt: 0.05,
} as const;

export const STARFIELD = {
  count: 2500,
  /** Half-size of the square (world units) that stars cover. */
  extent: 300,
  /** Stars sit below the play plane by this depth range for a parallax feel. */
  minDepth: 20,
  maxDepth: 120,
} as const;
