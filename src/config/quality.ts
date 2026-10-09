/**
 * Render quality. One ladder of levels, best first. The auto scaler walks it one step at a time when
 * frames are slow (resolution first, then bloom, then lensing and disk detail), and the Settings
 * presets pick fixed rungs of it.
 */

export interface QualityLevel {
  /** Render resolution as a fraction of the device pixel ratio (itself capped at RENDER.maxPixelRatio). */
  resolution: number;
  /** Bloom buffer size as a fraction of its normal size (bigger, softer glow when lower); 0 turns bloom off. */
  bloom: number;
  /** Lens samples per pixel near the Einstein ring, where the image is squeezed hardest: 0 turns lensing off, 1 to 4. */
  lensSamples: number;
  /** Accretion disk: stacked layers (each costs one disk of fill rate) and turbulence noise octaves. */
  diskLayers: number;
  diskOctaves: number;
}

export type QualityChoice = 'auto' | 'high' | 'medium' | 'low';

export const QUALITY = {
  levels: [
    { resolution: 1, bloom: 1, lensSamples: 4, diskLayers: 3, diskOctaves: 3 },
    { resolution: 0.85, bloom: 1, lensSamples: 4, diskLayers: 3, diskOctaves: 3 },
    { resolution: 0.7, bloom: 1, lensSamples: 4, diskLayers: 3, diskOctaves: 3 },
    { resolution: 0.7, bloom: 0.5, lensSamples: 4, diskLayers: 3, diskOctaves: 3 },
    { resolution: 0.7, bloom: 0.5, lensSamples: 1, diskLayers: 2, diskOctaves: 2 },
    { resolution: 0.6, bloom: 0, lensSamples: 1, diskLayers: 2, diskOctaves: 2 },
    { resolution: 0.5, bloom: 0, lensSamples: 0, diskLayers: 1, diskOctaves: 2 },
  ] as readonly QualityLevel[],
  /** Settings choices in menu order, with their labels. 'auto' runs the scaler; the others are fixed rungs. */
  choices: ['auto', 'high', 'medium', 'low'] as readonly QualityChoice[],
  labels: { auto: 'Auto', high: 'High', medium: 'Medium', low: 'Low' } as Record<QualityChoice, string>,
  presets: { high: 0, medium: 4, low: 6 } as Record<Exclude<QualityChoice, 'auto'>, number>,
  defaultChoice: 'auto' as QualityChoice,

  /** Auto scaler. Times are in seconds of real frame time; frame times in milliseconds. */
  auto: {
    /** Seconds of frames averaged per decision. */
    window: 2,
    /** Seconds ignored at start-up and after each change (render targets resize, shaders warm up). */
    settle: 1,
    /** Step down when a window averages above this. 20 ms is 50 fps. */
    downMs: 20,
    /** A window averaging below this is good (about every vsync at 60 Hz, or better). */
    goodMs: 17.5,
    /** Seconds of good windows in a row before trying one step up. */
    upAfter: 12,
    /** A slow window within this many seconds of a step up marks that level as too much: it is not retried this session. */
    probeTime: 20,
    /** A step down that cuts the average frame time by less than this fraction did not help (frame cap, or CPU bound). */
    minGain: 0.05,
    /** After this many unhelpful steps down in a row, undo them and stop scaling for the session. */
    maxUnhelpful: 2,
    /** A frame longer than this is a hitch (tab switch, shader compile, GC): it restarts the window. */
    hitchMs: 250,
    /** Level on a first visit, on a desktop and on a touch-first device. Later visits start where the last one settled. */
    startDesktop: 0,
    startTouch: 2,
  },
};
