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
