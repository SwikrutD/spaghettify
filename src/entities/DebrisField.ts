import * as THREE from 'three';
import { DEBRIS, PREY } from '../config';
import { radiusOfMass, type Player } from '../player/Player';
import { beginInfall, canSwallow, createPreyObject, lerp, PreyMesh, randomSpin, type PreyObject } from './PreyMesh';
import type { ViewSource } from './PreyField';

/** A pooled fragment of shed matter (a prey object, so it spaghettifies when eaten back). */
export interface Fragment extends PreyObject {
  /** False for an idle pool slot. */
  active: boolean;
  /** Seconds since it was thrown. */
  age: number;
  /** 0..1 heat glow: hot when thrown, cooling with age. */
  heat: number;
}

const tmpColor = new THREE.Color();

/**
 * Debris: the mass a hit sheds, thrown out as glowing rock fragments flung away from the contact. They slow
 * down and cool, and after a short delay the hole can eat them back (mass, not score; see Player.eat). Fixed
 * pool, one draw call; a full pool reuses the oldest fragment.
 */
export class DebrisField {
  readonly objects: Fragment[] = [];
  /** Fragments thrown this run (tests). */
  emitted = 0;
  private readonly mesh = new PreyMesh(DEBRIS.poolSize);
  private readonly weights = new Float32Array(DEBRIS.perHit);

  constructor(
    private readonly player: Player,
    private readonly view: ViewSource,
  ) {
    this.mesh.mesh.count = DEBRIS.poolSize;
    for (let i = 0; i < DEBRIS.poolSize; i++) {
      const frag: Fragment = Object.assign(createPreyObject(), { active: false, age: 0, heat: 0 });
      frag.className = 'debris';
      this.objects.push(frag);
      this.mesh.hide(i);
    }
    this.mesh.commit();
  }

  /** The instanced mesh; add it to the scene. */
  get object3d(): THREE.InstancedMesh {
    return this.mesh.mesh;
  }

  /** Fragments in flight or waiting to be eaten. */
  get live(): number {
    let n = 0;
    for (const f of this.objects) if (f.active && f.state === 'alive') n++;
    return n;
  }

  /** Total mass of the fragments still out there. */
  get liveMass(): number {
    let m = 0;
    for (const f of this.objects) if (f.active && f.state === 'alive') m += f.mass;
    return m;
  }

  reset(): void {
    this.emitted = 0;
    for (let i = 0; i < this.objects.length; i++) {
      this.objects[i].active = false;
      this.mesh.hide(i);
    }
    this.mesh.commit();
  }

  /**
   * Throw `mass` x DEBRIS.massFraction out of a hole of radius `holeRadius` at (x, z), fanned around the unit
   * direction (nx, nz) (away from the contact). `speed` is the hole's top speed at its size.
   */
  emit(x: number, z: number, nx: number, nz: number, holeRadius: number, mass: number, speed: number): void {
    const D = DEBRIS;
    const total = mass * D.massFraction;
    if (total <= 0) return;
    let sum = 0;
    for (let k = 0; k < D.perHit; k++) {
      this.weights[k] = lerp(D.weight[0], D.weight[1], Math.random());
      sum += this.weights[k];
    }
    const base = Math.atan2(nz, nx);
    for (let k = 0; k < D.perHit; k++) {
      const slot = this.freeSlot();
      const frag = this.objects[slot];
      // Spread evenly across the fan with a little jitter, so the fragments do not clump.
      const u = (k + 0.5 + (Math.random() - 0.5) * 0.8) / D.perHit;
      const angle = base + (u * 2 - 1) * D.spread;
      const cx = Math.cos(angle);
      const cz = Math.sin(angle);
      const v = speed * lerp(D.speedMin, D.speedMax, Math.random());
      frag.active = true;
      frag.state = 'alive';
      frag.age = 0;
      frag.heat = 1;
      frag.appear = 1;
      frag.eatProgress = 0;
      frag.stretch = 1;
      frag.mass = (total * this.weights[k]) / sum;
      frag.radius = radiusOfMass(frag.mass);
      frag.position.set(x + cx * holeRadius * D.launchRadius, 0, z + cz * holeRadius * D.launchRadius);
      frag.velocity.set(cx * v, 0, cz * v);
      randomSpin(frag);
      const { hue, sat, light } = D.color;
      tmpColor.setHSL(lerp(hue[0], hue[1], Math.random()), lerp(sat[0], sat[1], Math.random()), lerp(light[0], light[1], Math.random()));
      this.mesh.setColor(slot, tmpColor);
      this.emitted++;
    }
  }

  update(dt: number): void {
    const D = DEBRIS;
    const player = this.player;
    const drag = Math.exp(-D.drag * dt);
    const despawnSq = (D.despawnDistance * this.view.targetDistance) ** 2;
    this.mesh.setHole(player);
    for (let i = 0; i < this.objects.length; i++) {
      const frag = this.objects[i];
      if (!frag.active) continue;
      frag.age += dt;

      if (frag.state === 'eating') {
        frag.eatProgress += dt / frag.infallTime;
        if (frag.eatProgress >= 1) {
          this.free(i);
          continue;
        }
      } else {
        frag.position.addScaledVector(frag.velocity, dt);
        frag.velocity.multiplyScalar(drag);
        frag.heat = Math.exp(-D.coolRate * frag.age);
        const dx = frag.position.x - player.position.x;
        const dz = frag.position.z - player.position.z;
        const distSq = dx * dx + dz * dz;
        const left = D.lifetime - frag.age;
        if (left <= 0 || distSq > despawnSq) {
          this.free(i);
          continue;
        }
        frag.appear = Math.min(1, left / D.fadeTime);
        if (player.canEat && frag.age >= D.pickupDelay && canSwallow(frag.radius, player.radius)) {
          const reach = player.radius + frag.radius * PREY.eatReach;
          if (distSq < reach * reach) beginInfall(frag, player, true);
        }
      }
      frag.spinAngle += frag.spinSpeed * dt;
      this.mesh.write(i, frag, player);
      this.mesh.setHeat(i, frag.heat);
    }
    this.mesh.commit();
  }

  /** An idle slot, or the oldest fragment when the pool is full. */
  private freeSlot(): number {
    let oldest = 0;
    for (let i = 0; i < this.objects.length; i++) {
      const f = this.objects[i];
      if (!f.active) return i;
      if (f.age > this.objects[oldest].age) oldest = i;
    }
    return oldest;
  }

  private free(i: number): void {
    this.objects[i].active = false;
    this.mesh.hide(i);
    this.mesh.setHeat(i, 0);
  }
}
