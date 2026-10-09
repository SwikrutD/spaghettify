import * as THREE from 'three';
import { CAMERA, JUICE, TIER_UP } from '../config';
import type { View } from '../sim/View.ts';

/**
 * Tilted 2.5D follow camera. It frames the local hole's sim View (distance grows with the radius, Hole.io
 * style: zoom out slower than the hole grows, so the hole gets bigger on screen, and with the tier's camera
 * scale, which eases in when a tier begins) and adds presentation on top: the tier-up punch, meal kicks and shake.
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
  /** The local hole's view (sim state): the distance this camera frames. */
  private readonly view: View;

  constructor(view: View, target: THREE.Vector3) {
    const tilt = THREE.MathUtils.degToRad(CAMERA.tiltDegrees);
    // Camera sits behind (+Z) and above the focus, looking toward -Z and down.
    this.offsetDir = new THREE.Vector3(0, Math.sin(tilt), Math.cos(tilt));
    this.view = view;
    this.focus.copy(target);
    this.place();
  }

  /** Snap back to a fresh run (no easing). */
  reset(target: THREE.Vector3): void {
    this.punch = 0;
    this.shake = 0;
    this.kick = 0;
    this.focus.copy(target);
    this.place();
  }

  /** The distance the view is heading for (no tier-up punch). Spawning and despawning are sized from this. */
  get targetDistance(): number {
    return this.view.targetDistance;
  }

  /** The current view distance as a multiple of the starting distance, without the punch. Hole speed follows it. */
  get viewScale(): number {
    return this.view.viewScale;
  }

  addShake(amount: number): void {
    this.shake = Math.min(JUICE.tierShake * 1.5, this.shake + amount);
  }

  addKick(amount: number): void {
    this.kick = Math.min(JUICE.kickMax, Math.max(this.kick, amount));
  }

  /** `target` is the hole as drawn this frame; `dt` real seconds. */
  update(dt: number, target: THREE.Vector3): void {
    this.focus.lerp(target, 1 - Math.exp(-CAMERA.followSmoothing * dt));
    this.shakeTime += dt;
    this.shake *= Math.exp(-JUICE.shakeDecay * dt);
    this.kick *= Math.exp(-JUICE.kickDecay * dt);
    this.place();
  }

  /**
   * Horizontal FOV floor: a portrait screen widens the vertical FOV until it sees `CAMERA.minHorizontalFov`
   * across, up to `CAMERA.maxFov`; the rest of the shortfall pulls the camera back (the sim view's `aspect`).
   * Spawn rings and speed are in view distances, so they follow the pull-back. Landscape screens keep `CAMERA.fov`.
   */
  resize(width: number, height: number): void {
    const aspect = width / Math.max(height, 1);
    const tanHalf = (deg: number) => Math.tan(THREE.MathUtils.degToRad(deg) / 2);
    const neededTan = tanHalf(CAMERA.minHorizontalFov) / aspect;
    const tanV = Math.min(Math.max(neededTan, tanHalf(CAMERA.fov)), tanHalf(CAMERA.maxFov));
    this.camera.aspect = aspect;
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(tanV));
    this.view.aspect = Math.max(1, neededTan / tanV);
    this.place();
  }

  private place(): void {
    const distance = this.view.distance * (1 + TIER_UP.punchZoom * this.punch - this.kick);
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
