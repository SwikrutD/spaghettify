import * as THREE from 'three';
import { GROWTH, PLAYER } from '../config';
import type { MoveVector } from '../input/InputSource';

/** Mass of a sphere-ish body of the given radius. Shared by the player and prey so eating is consistent. */
export function massOfRadius(radius: number): number {
  return GROWTH.massDensity * radius * radius * radius;
}

/**
 * The baby black hole. Gameplay runs on the XZ plane (y = 0).
 * Placeholder visuals: black core plus a thin glowing ring (the real disk is M2).
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
  private readonly startMass = this.mass;

  constructor() {
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(1, 48, 32),
      new THREE.MeshBasicMaterial({ color: 0x000000 }),
    );
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.25, 1.9, 96),
      // Color above 1.0 so the bloom threshold catches it.
      new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.0, 0.3), side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    this.group.add(core, ring);
    this.applyRadius();
  }

  update(dt: number, move: MoveVector): void {
    // Screen up maps to -Z on the play plane.
    const tx = move.x * PLAYER.maxSpeed;
    const tz = -move.y * PLAYER.maxSpeed;
    const k = 1 - Math.exp(-PLAYER.responsiveness * dt);
    this.velocity.x += (tx - this.velocity.x) * k;
    this.velocity.z += (tz - this.velocity.z) * k;
    this.velocity.multiplyScalar(Math.exp(-PLAYER.drag * dt));
    this.position.addScaledVector(this.velocity, dt);

    const target = this.radiusForMass();
    this.setRadius(this.radius + (target - this.radius) * (1 - Math.exp(-GROWTH.radiusSmoothing * dt)));
  }

  /** Absorb a prey object of the given mass. */
  eat(preyMass: number): void {
    const gained = preyMass * GROWTH.absorbEfficiency;
    this.mass += gained;
    this.eatenMass += gained;
    this.eatenCount++;
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
