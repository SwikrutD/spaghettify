import { CAMERA, PLAYER, TIER_UP } from '../config/index.ts';

/** Camera distance for a hole radius alone: the view pulls back slower than the hole grows, so it gets bigger on screen. */
export function radiusDistance(radius: number): number {
  return CAMERA.startDistance * Math.pow(radius / PLAYER.startRadius, CAMERA.zoomExponent);
}

/**
 * How far out a hole's view is framed. Gameplay distances are measured in it (spawn and despawn rings, comet
 * paths, drift and top speed are in camera distances, so the field fills the screen at every size), and the
 * local player's camera frames exactly this, adding only presentation on top (tier-up punch, meal kick,
 * shake). The distance follows the radius smoothly and eases to the tier's scale, on real (unslowed) time.
 */
export class View {
  /** Smoothed distance from the radius alone. */
  radiusDistance: number;
  /** Tier scale, easing toward `tierScaleTarget` when a tier begins. */
  tierScale: number;
  tierScaleTarget: number;
  /** Hole radius at the last update. */
  radius: number;
  /** Extra pull-back from the client's horizontal FOV floor on portrait screens (see GameCamera.resize); 1 otherwise. */
  aspect = 1;

  constructor(radius: number, tierScale: number) {
    this.radius = radius;
    this.radiusDistance = radiusDistance(radius);
    this.tierScale = this.tierScaleTarget = tierScale;
  }

  /** Snap to a radius and tier scale (no easing). */
  reset(radius: number, tierScale: number): void {
    this.radius = radius;
    this.radiusDistance = radiusDistance(radius);
    this.tierScale = this.tierScaleTarget = tierScale;
  }

  /** The current framed distance (the camera adds its presentation on top). */
  get distance(): number {
    return this.radiusDistance * this.tierScale * this.aspect;
  }

  /** The distance the view is heading for, without the smoothing. Spawning and despawning are sized from this. */
  get targetDistance(): number {
    return radiusDistance(this.radius) * this.tierScaleTarget * this.aspect;
  }

  /** The current distance as a multiple of the starting distance. Top speed follows it, so on-screen speed holds. */
  get viewScale(): number {
    return this.distance / CAMERA.startDistance;
  }

  setTierScale(scale: number): void {
    this.tierScaleTarget = scale;
  }

  /** `dt` is real seconds (the view keeps easing during the tier-up slow motion). */
  update(dt: number, radius: number): void {
    this.radius = radius;
    this.radiusDistance += (radiusDistance(radius) - this.radiusDistance) * (1 - Math.exp(-CAMERA.followSmoothing * dt));
    this.tierScale += (this.tierScaleTarget - this.tierScale) * (1 - Math.exp(-TIER_UP.pullRate * dt));
  }
}
