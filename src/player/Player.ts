import * as THREE from 'three';
import { GROWTH, PLAYER } from '../config';
import type { MoveVector } from '../input/InputSource';
import { CORE_LAYER } from '../render/layers';
import { AccretionDisk } from './AccretionDisk';

/** Mass of a sphere-ish body of the given radius. Shared by the player and prey so eating is consistent. */
export function massOfRadius(radius: number): number {
  return GROWTH.massDensity * Math.pow(radius, GROWTH.massExponent);
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
  readonly disk = new AccretionDisk();
  private readonly startMass = this.mass;

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
    const maxSpeed = PLAYER.maxSpeed * Math.pow(viewScale, PLAYER.speedExponent);
    // Screen up maps to -Z on the play plane.
    const tx = move.x * maxSpeed;
    const tz = -move.y * maxSpeed;
    const k = 1 - Math.exp(-PLAYER.responsiveness * dt);
    this.velocity.x += (tx - this.velocity.x) * k;
    this.velocity.z += (tz - this.velocity.z) * k;
    this.velocity.multiplyScalar(Math.exp(-PLAYER.drag * dt));
    this.position.addScaledVector(this.velocity, dt);

    const target = this.radiusForMass();
    this.setRadius(this.radius + (target - this.radius) * (1 - Math.exp(-GROWTH.radiusSmoothing * dt)));
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
    this.disk.reset();
    this.setRadius(PLAYER.startRadius);
  }

  /** Absorb a prey object of the given mass. */
  eat(preyMass: number, what?: { name: string; radius: number }): void {
    if (what && (!this.biggestEaten || what.radius > this.biggestEaten.radius)) this.biggestEaten = what;
    const gained = preyMass * GROWTH.absorbEfficiency;
    this.mass += gained;
    this.eatenMass += gained;
    this.eatenCount++;
    this.disk.feed(gained / this.mass);
    this.onEat?.(preyMass, what);
  }

  /** Continuous mass-to-radius curve. */
  radiusForMass(): number {
    return PLAYER.startRadius * Math.pow(this.mass / this.startMass, GROWTH.radiusExponent);
  }

  setRadius(r: number): void {
    this.radius = r;
    this.applyRadius();
  }

  private applyRadius(): void {
    this.group.scale.setScalar(this.radius);
  }
}
