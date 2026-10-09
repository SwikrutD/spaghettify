export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Smooth 0..1 ease of t in 0..1. */
export function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  return smooth(clamp((x - edge0) / (edge1 - edge0), 0, 1));
}
