import * as THREE from 'three';
import { PREY } from '../config';
import { massOfRadius, type Player } from '../player/Player';

export type PreyState = 'alive' | 'eating';

/** One pooled prey object. The pool never grows or shrinks; entries are reused. */
export interface PreyObject {
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  radius: number;
  mass: number;
  state: PreyState;
  /** 0..1 scale-in after (re)spawning. */
  appear: number;
  /** 0..1 progress of the eat animation. */
  eatProgress: number;
  /** Position where the eat animation started. */
  readonly eatFrom: THREE.Vector3;
  readonly spinAxis: THREE.Vector3;
  spinAngle: number;
  spinSpeed: number;
}

const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const tmpPos = new THREE.Vector3();
const tmpMat = new THREE.Matrix4();
const tmpColor = new THREE.Color();

/** Placeholder prey: a fixed pool of rocks drawn as one InstancedMesh. Tiers and real spawning arrive in M5. */
export class PreyField {
  readonly mesh: THREE.InstancedMesh;
  readonly objects: PreyObject[] = [];

  constructor(private readonly player: Player) {
    this.mesh = new THREE.InstancedMesh(
      createRockGeometry(),
      new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, flatShading: true }),
      PREY.count,
    );
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    for (let i = 0; i < PREY.count; i++) {
      const obj: PreyObject = {
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        radius: 1,
        mass: 1,
        state: 'alive',
        appear: 1,
        eatProgress: 0,
        eatFrom: new THREE.Vector3(),
        spinAxis: new THREE.Vector3(0, 1, 0),
        spinAngle: 0,
        spinSpeed: 0,
      };
      this.objects.push(obj);
      this.respawn(i, PREY.initialInner, PREY.initialOuter, false);
    }
  }

  /** True if the player is big enough to eat this object. */
  isEdible(obj: PreyObject): boolean {
    return obj.radius < this.player.radius * PREY.edibleRatio;
  }

  update(dt: number): void {
    const player = this.player;
    const pr = player.radius;
    const despawnSq = (PREY.despawnDistance * pr) ** 2;
    const respawnSq = (PREY.respawnInner * pr) ** 2;
    // Leftovers the player has outgrown are recycled once they are off screen.
    const staleRadius = pr * PREY.sizeRelMin * PREY.staleRatio;

    for (let i = 0; i < this.objects.length; i++) {
      const obj = this.objects[i];

      if (obj.state === 'eating') {
        obj.eatProgress += dt / PREY.eatTime;
        if (obj.eatProgress >= 1) {
          this.respawn(i, PREY.respawnInner, PREY.respawnOuter, true);
        }
      } else {
        obj.position.addScaledVector(obj.velocity, dt);
        obj.appear = Math.min(1, obj.appear + dt / PREY.appearTime);

        const dx = obj.position.x - player.position.x;
        const dz = obj.position.z - player.position.z;
        const distSq = dx * dx + dz * dz;

        const outOfSight = distSq > respawnSq;
        if (distSq > despawnSq || (outOfSight && obj.radius < staleRadius)) {
          this.respawn(i, PREY.respawnInner, PREY.respawnOuter, true);
        } else if (this.isEdible(obj)) {
          const reach = pr + obj.radius * PREY.eatReach;
          if (distSq < reach * reach) {
            obj.state = 'eating';
            obj.eatProgress = 0;
            obj.eatFrom.copy(obj.position);
            player.eat(obj.mass);
          }
        }
      }

      obj.spinAngle += obj.spinSpeed * dt;
      this.writeInstance(i, obj);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private writeInstance(i: number, obj: PreyObject): void {
    let scale = obj.radius * smooth(obj.appear);
    tmpPos.copy(obj.position);
    if (obj.state === 'eating') {
      const t = obj.eatProgress;
      tmpPos.lerpVectors(obj.eatFrom, this.player.position, t * t);
      scale *= 1 - t;
    }
    tmpQuat.setFromAxisAngle(obj.spinAxis, obj.spinAngle);
    tmpScale.setScalar(Math.max(scale, 1e-4));
    tmpMat.compose(tmpPos, tmpQuat, tmpScale);
    this.mesh.setMatrixAt(i, tmpMat);
  }

  /** Reuse pool slot i as a fresh object in an annulus around the player (radii are in player radii). */
  private respawn(i: number, innerRel: number, outerRel: number, animate: boolean): void {
    const obj = this.objects[i];
    const pr = this.player.radius;

    obj.radius = pr * logUniform(PREY.sizeRelMin, PREY.sizeRelMax);
    obj.mass = massOfRadius(obj.radius);
    obj.state = 'alive';
    obj.appear = animate ? 0 : 1;
    obj.eatProgress = 0;

    // Uniform over the annulus area. Keep clear of the player so spawning never overlaps it.
    const minDist = Math.max(innerRel * pr, pr + obj.radius * 1.5);
    const maxDist = Math.max(outerRel * pr, minDist + pr);
    const dist = Math.sqrt(minDist * minDist + Math.random() * (maxDist * maxDist - minDist * minDist));
    const angle = Math.random() * Math.PI * 2;
    obj.position.set(
      this.player.position.x + Math.cos(angle) * dist,
      0,
      this.player.position.z + Math.sin(angle) * dist,
    );

    const driftAngle = Math.random() * Math.PI * 2;
    const drift = Math.random() * PREY.driftSpeed * pr;
    obj.velocity.set(Math.cos(driftAngle) * drift, 0, Math.sin(driftAngle) * drift);

    obj.spinAxis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
    if (obj.spinAxis.lengthSq() < 1e-4) obj.spinAxis.set(0, 1, 0);
    obj.spinAxis.normalize();
    obj.spinAngle = Math.random() * Math.PI * 2;
    obj.spinSpeed = (Math.random() * 2 - 1) * PREY.spinSpeed;

    tmpColor.setHSL(
      lerp(PREY.hueMin, PREY.hueMax, Math.random()),
      lerp(PREY.satMin, PREY.satMax, Math.random()),
      lerp(PREY.lightMin, PREY.lightMax, Math.random()),
    );
    this.mesh.setColorAt(i, tmpColor);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function logUniform(min: number, max: number): number {
  return Math.exp(lerp(Math.log(min), Math.log(max), Math.random()));
}

/** Lumpy unit rock. Displacement is a pure function of position, so duplicated vertices stay welded. */
function createRockGeometry(): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, PREY.meshDetail);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const n =
      Math.sin(v.x * 3.1 + 1.3) * Math.sin(v.y * 2.7 + 0.4) * Math.sin(v.z * 3.3 + 2.1) +
      0.5 * Math.sin(v.x * 7.3 + v.y * 5.1 + 0.7) * Math.sin(v.z * 6.1 + v.x * 2.3);
    v.multiplyScalar(1 + PREY.roughness * n);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}
