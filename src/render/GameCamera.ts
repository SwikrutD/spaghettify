import * as THREE from 'three';
import { CAMERA, JUICE, PLAYER, TIER_UP } from '../config';

/**
 * Tilted 2.5D follow camera. Distance grows with the player radius (Hole.io style: zoom out slower than
 * the hole grows, so the hole gets bigger on screen) and with the tier's camera scale, which eases in
 * when a tier begins.
 */
export class GameCamera {
  readonly camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 0.1, 1000);
  /** Extra pull-back, 0..1, driven by the tier-up set piece. */
  punch = 0;
  /** Shake strength as a fraction of the distance; decays by itself. Add with `addShake`. */
  shake = 0;
  /** Small zoom-in kick on meals, decays by itself. */
  kick = 0;
  private shakeTime = 0;
  private readonly focus = new THREE.Vector3();
  private readonly offsetDir: THREE.Vector3;
  /** Smoothed distance from the radius alone. */
  private radiusDistance: number;
  /** Smoothed tier scale, easing toward tierScaleTarget. */
  private tierScale: number;
  private tierScaleTarget: number;
  private radius: number;
  /** Extra distance from the horizontal FOV floor on narrow (portrait) screens, 1 otherwise. See `resize`. */
  private aspectScale = 1;

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
    this.shake = 0;
    this.kick = 0;
    this.radius = radius;
    this.radiusDistance = radiusDistance(radius);
    this.tierScale = this.tierScaleTarget = tierScale;
    this.focus.copy(target);
    this.place();
  }

  /** The distance the camera is heading for (no tier-up punch). Spawning and despawning are sized from this. */
  get targetDistance(): number {
    return radiusDistance(this.radius) * this.tierScaleTarget * this.aspectScale;
  }

  /** The current camera distance as a multiple of the starting distance, without the punch. Player speed follows it. */
  get viewScale(): number {
    return (this.radiusDistance * this.tierScale * this.aspectScale) / CAMERA.startDistance;
  }

  addShake(amount: number): void {
    this.shake = Math.min(JUICE.tierShake * 1.5, this.shake + amount);
  }

  addKick(amount: number): void {
    this.kick = Math.min(JUICE.kickMax, Math.max(this.kick, amount));
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
    this.shakeTime += dt;
    this.shake *= Math.exp(-JUICE.shakeDecay * dt);
    this.kick *= Math.exp(-JUICE.kickDecay * dt);
    this.place();
  }

  /**
   * Horizontal FOV floor: a portrait screen widens the vertical FOV until it sees `CAMERA.minHorizontalFov`
   * across, up to `CAMERA.maxFov`; the rest of the shortfall pulls the camera back. Spawn rings and speed are
   * in camera distances, so they follow the pull-back. Landscape screens keep `CAMERA.fov`.
   */
  resize(width: number, height: number): void {
    const aspect = width / Math.max(height, 1);
    const tanHalf = (deg: number) => Math.tan(THREE.MathUtils.degToRad(deg) / 2);
    const neededTan = tanHalf(CAMERA.minHorizontalFov) / aspect;
    const tanV = Math.min(Math.max(neededTan, tanHalf(CAMERA.fov)), tanHalf(CAMERA.maxFov));
    this.camera.aspect = aspect;
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(tanV));
    this.aspectScale = Math.max(1, neededTan / tanV);
    this.place();
  }

  private place(): void {
    const distance = this.radiusDistance * this.tierScale * this.aspectScale * (1 + TIER_UP.punchZoom * this.punch - this.kick);
    this.camera.position.copy(this.focus).addScaledVector(this.offsetDir, distance);
    if (this.shake > 1e-4) {
      const a = this.shake * distance;
      const t = this.shakeTime * JUICE.shakeFrequency;
      this.camera.position.x += Math.sin(t * 1.3) * a;
      this.camera.position.y += Math.sin(t * 1.7 + 1.1) * a * 0.6;
    }
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
