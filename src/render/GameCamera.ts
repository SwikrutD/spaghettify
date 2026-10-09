import * as THREE from 'three';
import { CAMERA, PLAYER, TIER_UP } from '../config';

/**
 * Tilted 2.5D follow camera. Distance grows with the player radius (Hole.io style: zoom out slower than
 * the hole grows, so the hole gets bigger on screen) and with the tier's camera scale, which eases in
 * when a tier begins.
 */
export class GameCamera {
  readonly camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 0.1, 1000);
  /** Extra pull-back, 0..1, driven by the tier-up set piece. */
  punch = 0;
  private readonly focus = new THREE.Vector3();
  private readonly offsetDir: THREE.Vector3;
  /** Smoothed distance from the radius alone. */
  private radiusDistance: number;
  /** Smoothed tier scale, easing toward tierScaleTarget. */
  private tierScale: number;
  private tierScaleTarget: number;
  private radius: number;

  constructor(target: THREE.Vector3, radius: number, tierScale: number) {
    const tilt = THREE.MathUtils.degToRad(CAMERA.tiltDegrees);
    // Camera sits behind (+Z) and above the focus, looking toward -Z and down.
    this.offsetDir = new THREE.Vector3(0, Math.sin(tilt), Math.cos(tilt));
    this.radius = radius;
    this.radiusDistance = radiusDistance(radius);
    this.tierScale = this.tierScaleTarget = tierScale;
    this.focus.copy(target);
    this.place();
  }

  /** Snap back to a fresh run (no easing). */
  reset(target: THREE.Vector3, radius: number, tierScale: number): void {
    this.punch = 0;
    this.radius = radius;
    this.radiusDistance = radiusDistance(radius);
    this.tierScale = this.tierScaleTarget = tierScale;
    this.focus.copy(target);
    this.place();
  }

  /** The distance the camera is heading for (no tier-up punch). Spawning and despawning are sized from this. */
  get targetDistance(): number {
    return radiusDistance(this.radius) * this.tierScaleTarget;
  }

  /** The current camera distance as a multiple of the starting distance, without the punch. Player speed follows it. */
  get viewScale(): number {
    return (this.radiusDistance * this.tierScale) / CAMERA.startDistance;
  }

  setTierScale(scale: number): void {
    this.tierScaleTarget = scale;
  }

  update(dt: number, target: THREE.Vector3, radius: number): void {
    const k = 1 - Math.exp(-CAMERA.followSmoothing * dt);
    this.focus.lerp(target, k);
    this.radius = radius;
    this.radiusDistance += (radiusDistance(radius) - this.radiusDistance) * k;
    this.tierScale += (this.tierScaleTarget - this.tierScale) * (1 - Math.exp(-TIER_UP.pullRate * dt));
    this.place();
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private place(): void {
    const distance = this.radiusDistance * this.tierScale * (1 + TIER_UP.punchZoom * this.punch);
    this.camera.position.copy(this.focus).addScaledVector(this.offsetDir, distance);
    this.camera.lookAt(this.focus);
    // Clip planes follow the distance so depth precision holds from a pea to a planet system.
    this.camera.near = distance * CAMERA.nearPerDistance;
    this.camera.far = distance * CAMERA.farPerDistance;
    this.camera.updateProjectionMatrix();
  }
}

function radiusDistance(radius: number): number {
  return CAMERA.startDistance * Math.pow(radius / PLAYER.startRadius, CAMERA.zoomExponent);
}
