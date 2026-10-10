import * as THREE from 'three';
import { CAMERA, JUICE, MILESTONE_FX } from '../config';
import type { GroundView } from '../entities/PreyMesh';
import { viewDistance } from '../sim/Hole.ts';

const tmpRay = new THREE.Vector3();
const tmpNdc = new THREE.Vector3();
const tmpGround = new THREE.Vector3();

/**
 * Tilted 2.5D follow camera. It frames the local hole at its view distance (from the radius alone, continuous:
 * the view pulls back slower than the hole grows, Hole.io style, so the hole gets bigger on screen), smoothed, and
 * pulled back further on portrait screens (see resize). On top it adds presentation: the milestone punch, meal
 * kicks and shake. Gameplay never reads this camera: a portrait player sees more but moves no faster.
 */
export class GameCamera {
  readonly camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 0.1, 1000);
  /** Extra pull-back, 0..1, driven by the milestone set piece. */
  punch = 0;
  /** Shake strength as a fraction of the distance; decays by itself. Add with `addShake`. */
  shake = 0;
  /** Small zoom-in kick on meals, decays by itself. */
  kick = 0;
  /** Extra pull-back from the horizontal FOV floor on portrait screens; 1 otherwise. */
  aspectScale = 1;
  /** View distance for the hole's radius, smoothed. */
  private radiusDistance: number = CAMERA.startDistance;
  /** Hole radius at the last update. */
  private radius = 0;
  private shakeTime = 0;
  private readonly focus = new THREE.Vector3();
  private readonly offsetDir: THREE.Vector3;
  private screenHeight = 1;

  constructor(target: THREE.Vector3, radius: number) {
    const tilt = THREE.MathUtils.degToRad(CAMERA.tiltDegrees);
    // Camera sits behind (+Z) and above the focus, looking toward -Z and down.
    this.offsetDir = new THREE.Vector3(0, Math.sin(tilt), Math.cos(tilt));
    this.reset(target, radius);
  }

  /** Snap to a fresh life (no easing). */
  reset(target: THREE.Vector3, radius: number): void {
    this.punch = 0;
    this.shake = 0;
    this.kick = 0;
    this.radius = radius;
    this.radiusDistance = viewDistance(radius);
    this.focus.copy(target);
    this.place();
  }

  /** The framed distance (smoothed, with the portrait pull-back, without the punch, kick or shake). */
  get distance(): number {
    return this.radiusDistance * this.aspectScale;
  }

  /** The distance the view is heading for: the hole's view distance with the portrait pull-back. */
  get targetDistance(): number {
    return viewDistance(this.radius) * this.aspectScale;
  }

  /** The current distance as a multiple of the starting distance (the starfield scales with it). */
  get viewScale(): number {
    return this.distance / CAMERA.startDistance;
  }

  addShake(amount: number): void {
    this.shake = Math.min(JUICE.milestoneShake * 1.5, this.shake + amount);
  }

  addKick(amount: number): void {
    this.kick = Math.min(JUICE.kickMax, Math.max(this.kick, amount));
  }

  /** `target` and `radius` are the hole as drawn this frame; `dt` real seconds. */
  update(dt: number, target: THREE.Vector3, radius: number): void {
    this.radius = radius;
    this.radiusDistance += (viewDistance(radius) - this.radiusDistance) * (1 - Math.exp(-CAMERA.followSmoothing * dt));
    this.focus.lerp(target, 1 - Math.exp(-CAMERA.followSmoothing * dt));
    this.shakeTime += dt;
    this.shake *= Math.exp(-JUICE.shakeDecay * dt);
    this.kick *= Math.exp(-JUICE.kickDecay * dt);
    this.place();
  }

  /**
   * Horizontal FOV floor: a portrait screen widens the vertical FOV until it sees `CAMERA.minHorizontalFov`
   * across, up to `CAMERA.maxFov`; the rest of the shortfall pulls the camera back. Landscape keeps `CAMERA.fov`.
   */
  resize(width: number, height: number): void {
    const aspect = width / Math.max(height, 1);
    const tanHalf = (deg: number) => Math.tan(THREE.MathUtils.degToRad(deg) / 2);
    const neededTan = tanHalf(CAMERA.minHorizontalFov) / aspect;
    const tanV = Math.min(Math.max(neededTan, tanHalf(CAMERA.fov)), tanHalf(CAMERA.maxFov));
    this.camera.aspect = aspect;
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(tanV));
    this.aspectScale = Math.max(1, neededTan / tanV);
    this.screenHeight = Math.max(height, 1);
    this.place();
  }

  /**
   * What the camera sees on the play plane, into `out`: the trapezoid between where the bottom and the top screen
   * edges meet the plane (grown by `margin`), a circle holding it, and the world size of a CSS pixel at the focus.
   */
  groundView(out: GroundView, margin = 0): void {
    const cam = this.camera;
    // Bottom (near) and top (far) screen edges; the camera never rolls or turns, so each edge is level in z.
    out.nearZ = this.ground(-1, -1).z + margin;
    out.nearHalf = (this.ground(1, -1).x - this.ground(-1, -1).x) / 2 + margin;
    const far = this.ground(-1, 1);
    const farLeft = far.x;
    out.farZ = far.z - margin;
    out.farHalf = (this.ground(1, 1).x - farLeft) / 2 + margin;
    out.x = cam.position.x;
    out.z = (out.nearZ + out.farZ) / 2;
    out.radius = Math.hypot(Math.max(out.nearHalf, out.farHalf), (out.nearZ - out.farZ) / 2);
    const distance = cam.position.distanceTo(this.focus);
    out.unitsPerPixel = (2 * distance * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) / this.screenHeight;
  }

  /** Where the ray through screen point (nx, ny) (normalised -1..1) meets the play plane. */
  private ground(nx: number, ny: number): THREE.Vector3 {
    const cam = this.camera;
    tmpNdc.set(nx, ny, 0.5).unproject(cam);
    tmpRay.copy(tmpNdc).sub(cam.position);
    // Every corner ray points down at the plane (the tilt is steeper than half the widest FOV).
    const t = tmpRay.y < -1e-6 ? -cam.position.y / tmpRay.y : 1e6;
    return tmpGround.set(cam.position.x + tmpRay.x * t, 0, cam.position.z + tmpRay.z * t);
  }

  private place(): void {
    const distance = this.distance * (1 + MILESTONE_FX.punchZoom * this.punch - this.kick);
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
    this.camera.updateMatrixWorld();
  }
}
