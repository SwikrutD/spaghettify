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

export const DISK = {
  /** Inner edge in player radii (the black core has radius 1). Real disks stop at the innermost stable orbit. */
  innerRadius: 1.35,
  /** Outer edge in player radii at heat 0 and heat 1. Heat is the 0..1 feeding level, see below. */
  outerRadiusMin: 3.0,
  outerRadiusMax: 4.4,
  /** Half-thickness at the outer edge in player radii at heat 0 and 1. The disk flares from zero at the inner edge. */
  thicknessMin: 0.06,
  thicknessMax: 0.2,
  /** Stacked layers that give the disk volume. Each costs one full disk of fill rate. */
  layers: 3,
  /** Brightness falloff across layers: weight = exp(-layerFalloff * layer^2), layer in -1..1. */
  layerFalloff: 1.6,
  thetaSegments: 160,
  radialSegments: 6,
  /** +1 = counter-clockwise seen from above, -1 = clockwise. */
  spin: 1,
  /** Visual orbital angular speed at the inner edge (rad/s). Falls off as r^-1.5 (Kepler). */
  innerAngularSpeed: 1.4,
  /** Seconds per flow-map cycle. Shorter smears less but cross-fades more visibly. */
  flowPeriod: 6,
  /** Orbital speed at the inner edge as a fraction of c, for Doppler beaming. Falls off as r^-0.5. */
  dopplerBeta: 0.55,
  /** Observed intensity scales with the Doppler factor to this power (3 is the textbook value for a disk). */
  beamingPower: 3,
  /** Zero-torque inner boundary strength (1 = emission drops to zero at the inner edge). */
  innerTorque: 0.85,
  /** Peak disk temperature in kelvin at heat 0 and 1. Feeding heats the disk (T scales as accretion rate^1/4). */
  peakKelvinMin: 3800,
  peakKelvinMax: 6000,
  /** Colour saturation boost around luminance. 1 = plain blackbody colour; higher reads better after tone mapping. */
  colorSaturation: 1.4,
  /** Emission falls off as (T / Tpeak) ^ this. 4 would be Stefan-Boltzmann; lower keeps the outer disk visible. */
  tempIntensityPower: 3,
  /** Overall HDR emission scale at heat 0 and 1. */
  brightnessMin: 0.5,
  brightnessMax: 0.75,
  /** Turbulence: noise frequency across radius (per log radius) and around the disk, spiral twist and contrast. */
  noiseRadialFreq: 7,
  noiseAngularFreq: 1.6,
  spiralTwist: 1.2,
  contrast: 1.0,
  noiseOctaves: 3,
  /** Fraction of the disk width over which the outer edge fades. */
  outerSoftness: 0.55,
  /**
   * Heat = growthWeight * growth + activityWeight * (1 - exp(-activity)), clamped to 0..1.
   * growth: log of (1 + eatenMass / startMass), reaching 1 when that ratio hits growthFullMassRatio.
   * activity: recent accretion rate; each meal adds (gained mass / current mass) * feedGain, decaying at feedDecay (1/s).
   */
  growthWeight: 0.45,
  growthFullMassRatio: 300,
  activityWeight: 0.7,
  feedGain: 5,
  feedDecay: 0.45,
  /** How fast the displayed heat rises and falls (1/s). Fast flare, slow cool. */
  heatRise: 6,
  heatFall: 1.2,
} as const;

export const PHOTON_RING = {
  /** Ring radius and width in core radii. */
  radius: 1.03,
  width: 0.07,
  /** HDR intensity at heat 0 and 1. */
  intensityMin: 0.8,
  intensityMax: 1.6,
  /** Ring colour temperature as a fraction of the disk peak temperature. */
  kelvinFactor: 0.9,
} as const;

export const BLOOM = {
  /** Only the hot inner disk and the photon ring exceed the threshold (pre tone mapping HDR). */
  strength: 0.4,
  /** Small radius keeps the glow tight so it does not wash over the black core. */
  radius: 0.12,
  threshold: 1.0,
  /** Redraw the black core after bloom so glow never washes over the shadow. */
  keepCoreBlack: true,
} as const;

export const RENDER = {
  /** ACES filmic tone mapping exposure. The disk is HDR; tone mapping rolls it off instead of clipping. */
  toneMappingExposure: 1.1,
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
