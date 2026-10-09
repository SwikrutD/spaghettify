import * as THREE from 'three';
import { DANGER, GROWTH, PLAYER } from '../config';
import type { MoveVector } from '../input/InputSource';
import { CORE_LAYER } from '../render/layers';
import { AccretionDisk } from './AccretionDisk';

/** Mass of a sphere-ish body of the given radius. Shared by the player and prey so eating is consistent. */
export function massOfRadius(radius: number): number {
  return GROWTH.massDensity * Math.pow(radius, GROWTH.massExponent);
}

/** Radius of a body of the given mass (the inverse of massOfRadius). */
export function radiusOfMass(mass: number): number {
  return Math.pow(mass / GROWTH.massDensity, 1 / GROWTH.massExponent);
}

/** The hole's top speed at a view scale (camera distance over its starting distance): constant on screen. */
export function topSpeed(viewScale: number): number {
  return PLAYER.maxSpeed * Math.pow(viewScale, PLAYER.speedExponent);
}

/**
 * The baby black hole. Gameplay runs on the XZ plane (y = 0).
 * Visuals: a black core with an accretion disk and photon ring. The group is scaled by radius.
 */
export class Player {
  readonly group = new THREE.Group();
  readonly position = this.group.position;
  readonly velocity = new THREE.Vector3();
  /** Visible radius. Chases radiusForMass(mass) so growth is smooth. */
  radius: number = PLAYER.startRadius;
  mass = massOfRadius(PLAYER.startRadius);
  /** Total mass eaten this run. */
  eatenMass = 0;
  eatenCount = 0;
  /** False once the run is lost: the hole no longer eats while it evaporates. */
  canEat = true;
  /** Biggest thing eaten this run. */
  biggestEaten: { name: string; radius: number } | null = null;
  /** Called after each meal with the prey mass and what was eaten. */
  onEat: ((preyMass: number, what?: { name: string; radius: number }) => void) | null = null;
  /** External acceleration (gravity pull from big bodies), set each frame by Dangers. */
  readonly pull = new THREE.Vector3();
  /** Seconds left of a hit's stun: input is ignored and the knockback carries the hole. */
  stun = 0;
  readonly disk = new AccretionDisk();
  /** Mass at the start of a run. A hit never takes the hole below it. */
  readonly startMass = this.mass;
  /** Seconds left of a hit's squash; while it runs the radius drops fast to the shed mass. */
  private squash = 0;

  constructor() {
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(1, 48, 32),
      new THREE.MeshBasicMaterial({ color: 0x000000 }),
    );
    // Not on the default layer: the core is drawn over the lensed image (never bent) and again
    // after bloom so the shadow stays crisp (see LensingPass and CorePass).
    core.layers.set(CORE_LAYER);
    this.group.add(core, this.disk.group);
    this.applyRadius();
  }

  /** `viewScale` is the camera distance as a multiple of its starting distance: speed follows it so the on-screen speed holds. */
  update(dt: number, move: MoveVector, viewScale: number): void {
    const maxSpeed = topSpeed(viewScale);
    const stunned = this.stun > 0;
    this.stun = Math.max(0, this.stun - dt);
    // Screen up maps to -Z on the play plane.
    const tx = stunned ? 0 : move.x * maxSpeed;
    const tz = stunned ? 0 : -move.y * maxSpeed;
    const k = 1 - Math.exp(-(stunned ? DANGER.stunResponsiveness : PLAYER.responsiveness) * dt);
    this.velocity.x += (tx - this.velocity.x) * k;
    this.velocity.z += (tz - this.velocity.z) * k;
    this.velocity.addScaledVector(this.pull, dt);
    this.velocity.multiplyScalar(Math.exp(-PLAYER.drag * dt));
    this.position.addScaledVector(this.velocity, dt);

    const target = this.radiusForMass();
    this.squash = Math.max(0, this.squash - dt);
    const rate = this.squash > 0 && target < this.radius ? DANGER.shrinkRate : GROWTH.radiusSmoothing;
    this.setRadius(this.radius + (target - this.radius) * (1 - Math.exp(-rate * dt)));
    this.disk.update(dt, this.eatenMass / this.startMass);
  }

  /** Back to a fresh run at the origin. */
  reset(): void {
    this.mass = this.startMass;
    this.eatenMass = 0;
    this.eatenCount = 0;
    this.canEat = true;
    this.biggestEaten = null;
    this.position.set(0, 0, 0);
    this.velocity.set(0, 0, 0);
    this.pull.set(0, 0, 0);
    this.stun = 0;
    this.squash = 0;
    this.disk.reset();
    this.setRadius(PLAYER.startRadius);
  }

  /**
   * Absorb a prey object of the given mass. `reclaimed` is the hole's own shed debris: the mass comes back but
   * it is not score (eatenMass) and never the biggest meal, so bumping to farm debris gains nothing.
   */
  eat(preyMass: number, what?: { name: string; radius: number }, reclaimed = false): void {
    if (!reclaimed && what && (!this.biggestEaten || what.radius > this.biggestEaten.radius)) this.biggestEaten = what;
    const gained = preyMass * GROWTH.absorbEfficiency;
    this.mass += gained;
    if (!reclaimed) this.eatenMass += gained;
    this.eatenCount++;
    this.disk.feed(gained / this.mass);
    this.onEat?.(preyMass, what);
  }

  /** Lose mass to a hit, never below the start mass: the radius drops fast with a squash. Returns the mass lost. */
  shed(fraction: number): number {
    const target = Math.max(this.mass * (1 - fraction), Math.min(this.mass, this.startMass));
    const lost = this.mass - target;
    this.mass = target;
    this.squash = DANGER.squashTime;
    return lost;
  }

  /** Continuous mass-to-radius curve. */
  radiusForMass(): number {
    return PLAYER.startRadius * Math.pow(this.mass / this.startMass, GROWTH.radiusExponent);
  }

  setRadius(r: number): void {
    this.radius = r;
    this.applyRadius();
  }

  /** Group scale: the radius, flattened and widened a little by a hit's squash (a damped wobble). */
  private applyRadius(): void {
    const r = this.radius;
    if (this.squash <= 0) {
      this.group.scale.setScalar(r);
      return;
    }
    const t = 1 - this.squash / DANGER.squashTime;
    const w = DANGER.squashAmount * Math.sin(t * Math.PI * 2) * (1 - t);
    this.group.scale.set(r * (1 + w * 0.5), r * (1 - w), r * (1 + w * 0.5));
  }
}
