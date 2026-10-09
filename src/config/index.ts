/** All tunable numbers live here. Game logic must not hard-code these. */

export * from './tiers';

export const PLAYER = {
  /** Starting radius in world units ("pea-sized"). */
  startRadius: 0.5,
  /** Top speed in world units per second at the starting camera distance. */
  maxSpeed: 9,
  /**
   * Top speed scales with the camera distance ^ this. 1 keeps the on-screen speed constant as the view
   * zooms out (the Hole.io feel: always fast); above 1 gets slightly faster on screen as you grow.
   */
  speedExponent: 1,
  /** How quickly velocity chases the desired velocity (1/s). Lower = more drifty. */
  responsiveness: 3.2,
  /** Passive drag applied every frame (1/s). */
  drag: 0.4,
} as const;

export const GROWTH = {
  /**
   * Mass of an object of radius r is massDensity * r ^ massExponent (the player starts with the same rule).
   * 2 makes mass an area, like Hole.io: eating an object adds its area to the hole, so growth stays
   * proportionate at every scale. Tier thresholds are in these mass units (mass = radius squared).
   */
  massDensity: 1,
  massExponent: 2,
  /** Fraction of a prey object's mass that the player absorbs. */
  absorbEfficiency: 1,
  /** radius = startRadius * (mass / startMass) ^ radiusExponent. Keep at 1 / massExponent to conserve area; higher grows faster. */
  radiusExponent: 0.5,
  /** How quickly the visible radius chases the radius implied by mass (1/s). */
  radiusSmoothing: 5,
} as const;

/**
 * Hunger: Hawking radiation as the fail state. Go too long without eating and the hole slowly evaporates
 * (mass drains); when mass reaches the floor the run ends. Times are in game seconds unless noted.
 */
export const HUNGER = {
  /** Seconds since the last meal before mass starts to drain. */
  graceTime: 7,
  /** Seconds since the last meal when the warning starts to build (before the drain begins). */
  warnTime: 3.5,
  /** Fraction of mass lost per second once the drain is at full strength. */
  decayRate: 0.09,
  /** Seconds for the drain to ramp from zero to full strength after the grace time. */
  rampTime: 2,
  /** The run ends when mass falls to max(failMass, runPeakMass * failPeakFraction). */
  failMass: 0.1,
  failPeakFraction: 0.5,
  /** Real seconds of the final evaporation before the score screen, and how fast mass drains in it (1/s). */
  evaporateTime: 1.8,
  evaporateRate: 1.6,
  /** The evaporating hole shrinks to this fraction of the fail mass and no further. */
  evaporateFloorFraction: 0.4,
  /** How quickly the displayed hunger level follows the real one (1/s). */
  levelRate: 4,
  /** The warning text shows above this hunger level (0..1). */
  warnTextLevel: 0.3,
  /** Screen vignette opacity at full hunger. */
  vignetteMax: 0.9,
  /** Score points per unit of mass eaten (mass is an area, so raw values are small early on). */
  pointsPerMass: 1000,
} as const;

export const PREY = {
  /** Player can eat an object whose radius is below this fraction of its own radius. */
  edibleRatio: 0.95,
  /** Eaten when the distance to the player is below playerRadius + preyRadius * eatReach. */
  eatReach: 0.25,
  /**
   * Spawn and despawn distances are in camera distances (the view scale), so the field always covers the
   * screen whatever the tier. Initial fill (and tier-up refill): spawn distance range.
   */
  initialInner: 0.15,
  initialOuter: 1.45,
  /** Respawn ring, just beyond the visible area. */
  respawnInner: 1.2,
  respawnOuter: 1.55,
  /** Objects farther than this are recycled. */
  despawnDistance: 2,
  /**
   * Prey smaller than this fraction of the player radius are specks: never spawned (when the tier
   * table has anything bigger) and recycled once off screen. Keeps the screen full of useful prey.
   */
  minRelSize: 0.07,
  /** Max drift speed in camera distances per second. */
  driftSpeed: 0.006,
  /** Max spin speed in rad/s. */
  spinSpeed: 0.8,
  /** Seconds to scale in after spawning. */
  appearTime: 0.5,
  /** Rock surface roughness (fraction of radius) and mesh detail. */
  roughness: 0.18,
  meshDetail: 2,
} as const;

/**
 * Spaghettification: tidal stretching of edible prey on the way into the hole. Prey stretch along the
 * line to the hole and thin out across it. Bigger edible prey (relative to the player) stretch more and
 * fall in more slowly. Inedible objects are inert.
 */
export const SPAGHETTI = {
  /** Edible prey start to stretch when the gap between their surface and the core is below this (player radii). */
  onsetGap: 2.5,
  /** Stretch factor (length / original) just before being eaten, for the largest edible prey. */
  approachStretch: 1.5,
  /** Peak stretch factor during the infall, for the largest edible prey. */
  maxStretch: 6,
  /** Across-axis scale = stretch ^ -squeeze. 0.5 preserves volume; lower keeps the stream fatter. */
  squeeze: 0.5,
  /** Size weight = (preyRadius / (playerRadius * edibleRatio)) ^ sizePower scales stretch, curl and infall time. */
  sizePower: 1,
  /** Infall duration in seconds for the smallest and the largest edible prey. */
  infallTimeMin: 0.35,
  infallTimeMax: 0.85,
  /** Distance to the hole shrinks as 1 - t^accelPower over the infall (t = 0..1): slow start, then a plunge. */
  accelPower: 2,
  /** Angle (radians) the falling object swings around the hole, in the disk's spin direction. */
  swirl: 0.7,
  /** The stream winds into a spiral: the end nearer the hole leads by curl radians per e-fold of distance. */
  curl: 0.6,
  /** Infall progress (0..1) at which the object starts draining into the core; fully gone at 1. */
  drainStart: 0.55,
  /** Radial distances below knee * core radius are squashed toward the centre so nothing pokes out the far side. */
  knee: 0.5,
  /** Tidal heating: HDR emissive glow near the hole while falling in. Parts within glowReach core radii glow. */
  glowColor: 0xff7a30,
  glowIntensity: 2.5,
  glowReach: 3,
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
  /** Distance from the player at the starting radius. */
  startDistance: 11,
  /**
   * Distance grows as (radius / startRadius) ^ zoomExponent. Below 1 the hole gets bigger on screen as
   * it grows (0 would never zoom out, 1 keeps it the same size). Hole.io style: grow, zoom out slowly.
   */
  zoomExponent: 0.7,
  fov: 45,
  /** Clip planes as a multiple of the camera distance, so depth precision holds at every scale. */
  nearPerDistance: 0.009,
  farPerDistance: 180,
  /** Camera follow smoothing (1/s). */
  followSmoothing: 6,
} as const;

export const DISK = {
  /** Inner edge in player radii (the black core has radius 1). Real disks stop at the innermost stable orbit. */
  innerRadius: 1.35,
  /** Outer edge in player radii at heat 0 and heat 1. Heat is the 0..1 feeding level, see below. */
  outerRadiusMin: 3.0,
  outerRadiusMax: 3.6,
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
  growthFullMassRatio: 100000,
  activityWeight: 0.7,
  feedGain: 5,
  feedDecay: 0.45,
  /** How fast the displayed heat rises and falls (1/s). Fast flare, slow cool. */
  heatRise: 6,
  heatFall: 1.2,
  /** Starving dims the disk: brightness and ring intensity are multiplied by 1 - starveDim * hunger. */
  starveDim: 0.8,
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

export const LENSING = {
  /**
   * Einstein radius for the far background (stars), in player radii. A star directly behind the hole
   * is smeared into a ring this far from its centre; inside the ring is a squeezed, flipped image of
   * the sky on the far side. This is the main strength knob.
   */
  einsteinRadius: 4,
  /**
   * Einstein radius for things on the play plane (prey and the disk's own image), once they are
   * planeDepthRange behind the hole. Kept well below einsteinRadius so prey stay readable.
   */
  planeEinsteinRadius: 1.6,
  /**
   * Real lensing grows with the source's distance behind the lens: nothing in front of the hole bends.
   * Play-plane bending ramps from zero at planeDepthSoft player radii in front of the hole to full at
   * planeDepthRange behind it (depth measured along the view axis).
   */
  planeDepthRange: 3,
  planeDepthSoft: 0.5,
  /** Bending falls off as distance ^ -falloff. 1 is a point mass; higher keeps it tighter around the hole. */
  falloff: 1,
  /** Lens reach in player radii. The bending fades smoothly to zero here so the lens has a finite footprint. */
  radius: 18,
  /** Detail level, an index into samples. M8 lowers it on slow devices. */
  quality: 2,
  /** Samples per pixel near the ring, where the image is squeezed hardest, per quality level. 0 = lensing off. */
  samples: [0, 1, 4],
  /** Supersampled zone radius as a multiple of einsteinRadius. */
  sampleZone: 1.3,
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
  /** Dense enough that the lens always has stars to bend into arcs. */
  count: 9000,
  /** Half-size of the square (world units) that stars cover. */
  extent: 300,
  /** Stars sit below the play plane by this depth range for a parallax feel. */
  minDepth: 20,
  maxDepth: 120,
} as const;

export const AUDIO = {
  storageKey: 'spaghettify.audio',
  /** Defaults when nothing is stored (0..1 sliders). */
  defaultMusic: 0.6,
  defaultSfx: 0.8,
  /** Slider value is squared to get gain (closer to perceived loudness). */
  volumeCurve: 2,
  /** Seconds for volume and mute changes to settle (avoids clicks). */
  volumeSmoothing: 0.03,
  /** Peak gains before the sliders. */
  musicLevel: 0.5,
  sfxLevel: 0.7,

  drone: {
    /** Pitch of the drone at the starting radius (Hz); it falls as the hole grows. */
    baseFreq: 82,
    minFreq: 30,
    /** Frequency = baseFreq * (radius / startRadius) ^ -pitchExponent. */
    pitchExponent: 0.3,
    /** Lowpass cutoff when small and when huge (Hz); hunger closes it by `hungerCutoffScale`. */
    cutoffSmall: 900,
    cutoffBig: 260,
    hungerCutoffScale: 0.35,
    /** Detune between the two saws in cents; hunger widens it. */
    detune: 7,
    hungerDetune: 45,
    /** Dissonant extra voice (ratio to the root) that fades in with hunger. */
    dissonantRatio: 1.4142,
    dissonantLevel: 0.35,
    /** Tremolo that quickens with hunger (Hz) and its depth at full hunger. */
    tremoloMin: 0.15,
    tremoloMax: 5.5,
    tremoloDepth: 0.5,
    /** Level of each part. */
    sawLevel: 0.16,
    subLevel: 0.4,
    rumbleLevel: 0.1,
    /** Seconds for pitch and filter to follow the game. */
    follow: 0.4,
    /** Seconds to fade the drone out when the hole evaporates and back in on restart. */
    fadeOut: 1.4,
    fadeIn: 1.5,
  },

  eat: {
    /** Pitch (Hz) of the smallest and the biggest meal; bigger prey sound lower. */
    freqSmall: 1400,
    freqBig: 200,
    /** Prey radius as a fraction of the hole radius mapped to freqSmall..freqBig. */
    relSmall: 0.05,
    relBig: 0.95,
    duration: 0.12,
    bigDuration: 0.35,
    level: 0.35,
    /** Minimum seconds between eat sounds, and the most overlapping at once. */
    minGap: 0.035,
  },

  grow: {
    /** A growth chime plays each time the radius grows by this factor since the last one. */
    radiusStep: 1.18,
    freqs: [330, 495, 660],
    level: 0.25,
    noteGap: 0.06,
  },

  tierUp: {
    level: 0.5,
    sweepFrom: 70,
    sweepTo: 440,
    sweepTime: 0.9,
    /** Chord (Hz) that blooms after the sweep. */
    chord: [220, 330, 440, 660],
    chordTime: 1.8,
  },

  warning: {
    /** Hunger level (0..1) above which the warning pulses start. */
    startLevel: 0.3,
    freq: 150,
    level: 0.4,
    /** Seconds between pulses at the start level and at full hunger. */
    periodSlow: 1.1,
    periodFast: 0.35,
  },

  evaporate: {
    level: 0.6,
    time: 1.8,
    sweepFrom: 900,
    sweepTo: 28,
  },
} as const;
