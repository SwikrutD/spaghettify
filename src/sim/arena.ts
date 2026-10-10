import { ARENA } from '../config/index.ts';
import { viewDistance, type Hole } from './Hole.ts';
import type { Vec2 } from './vec.ts';

/** Width of the soft edge for a hole of this radius: a fraction of its view, so it feels the same at every size. */
export function edgeWidth(radius: number): number {
  return Math.min(ARENA.edgeMaxWidth, ARENA.edgeSoftness * viewDistance(radius));
}

/**
 * The gas wall at the arena edge: an acceleration (into `out`) pushing a hole at (x, z) back toward the centre.
 * Zero until the hole is within its soft edge width of the edge, then growing with the square of the depth, to
 * ARENA.edgeStrength times its steering `authority` at the edge itself, so it cannot be crossed.
 */
export function edgePush(x: number, z: number, radius: number, authority: number, out: Vec2): void {
  const d = Math.hypot(x, z);
  const width = edgeWidth(radius);
  const depth = (d - (ARENA.radius - width)) / width;
  if (depth <= 0 || d < 1e-9) {
    out.x = out.z = 0;
    return;
  }
  const a = (authority * ARENA.edgeStrength * depth * depth) / d;
  out.x = -x * a;
  out.z = -z * a;
}

/** Hard limit: a hole never gets more than ARENA.edgeHardLimit of its soft width past the edge, and stops moving outward there. */
export function clampToArena(hole: Hole): void {
  const p = hole.position;
  const d = Math.hypot(p.x, p.z);
  const limit = ARENA.radius + ARENA.edgeHardLimit * edgeWidth(hole.radius);
  if (d <= limit) return;
  const nx = p.x / d;
  const nz = p.z / d;
  p.x = nx * limit;
  p.z = nz * limit;
  const v = hole.velocity;
  const out = v.x * nx + v.z * nz;
  if (out > 0) {
    v.x -= out * nx;
    v.z -= out * nz;
  }
}

/** True if a circle of this radius at (x, z) lies inside the arena, ARENA.edgeMargin clear of the edge. */
export function insideArena(x: number, z: number, radius: number): boolean {
  const limit = ARENA.radius - ARENA.edgeMargin - radius;
  return limit > 0 && x * x + z * z < limit * limit;
}
