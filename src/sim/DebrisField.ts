import { DEBRIS } from '../config/index.ts';
import { capture, createBody, spawned, type Body } from './body.ts';
import { radiusOfMass, type Hole } from './Hole.ts';
import { lerp } from './math.ts';
import type { World } from './World.ts';

/** A pooled fragment of shed matter (a body, so it spaghettifies when eaten). */
export interface Fragment extends Body {
  /** False for an idle pool slot. */
  active: boolean;
  /** Seconds since it was thrown. */
  age: number;
  /** 0..1 heat glow: hot when thrown, cooling with age. */
  heat: number;
  /** Id of the hole that shed it: eating your own debris back is mass without score; anyone else scores it. */
  ownerId: number;
}

/**
 * Debris: the mass a hit sheds, thrown out as glowing rock fragments flung away from the contact. They slow
 * down and cool, and after a short delay any hole can eat them (the owner gets mass back but no score; see
 * Hole.eat). Fixed pool; a full pool reuses the oldest fragment.
 */
export class DebrisField {
  readonly objects: Fragment[] = [];
  /** Fragments thrown this run (tests). */
  emitted = 0;
  private readonly world: World;
  private readonly weights = new Float64Array(DEBRIS.perHit);

  constructor(world: World) {
    this.world = world;
    for (let i = 0; i < DEBRIS.poolSize; i++) {
      const frag: Fragment = Object.assign(createBody(DEBRIS.color), { active: false, age: 0, heat: 0, ownerId: -1 });
      frag.className = 'debris';
      this.objects.push(frag);
    }
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
    for (const frag of this.objects) frag.active = false;
  }

  /**
   * Throw `mass` x DEBRIS.massFraction out of `hole`, fanned around the unit direction (nx, nz) (away from the
   * contact). `speed` is the hole's top speed at its size.
   */
  emit(hole: Hole, nx: number, nz: number, mass: number, speed: number): void {
    const D = DEBRIS;
    const rng = this.world.rng;
    const total = mass * D.massFraction;
    if (total <= 0) return;
    let sum = 0;
    for (let k = 0; k < D.perHit; k++) {
      this.weights[k] = rng.range(D.weight[0], D.weight[1]);
      sum += this.weights[k];
    }
    const base = Math.atan2(nz, nx);
    for (let k = 0; k < D.perHit; k++) {
      const frag = this.objects[this.freeSlot()];
      // Spread evenly across the fan with a little jitter, so the fragments do not clump.
      const u = (k + 0.5 + (rng.next() - 0.5) * 0.8) / D.perHit;
      const angle = base + (u * 2 - 1) * D.spread;
      const cx = Math.cos(angle);
      const cz = Math.sin(angle);
      const v = speed * lerp(D.speedMin, D.speedMax, rng.next());
      frag.active = true;
      frag.age = 0;
      frag.heat = 1;
      frag.appear = 1;
      frag.ownerId = hole.id;
      frag.mass = (total * this.weights[k]) / sum;
      frag.radius = radiusOfMass(frag.mass);
      frag.position.x = hole.position.x + cx * hole.radius * D.launchRadius;
      frag.position.z = hole.position.z + cz * hole.radius * D.launchRadius;
      frag.velocity.x = cx * v;
      frag.velocity.z = cz * v;
      spawned(frag, rng);
      this.emitted++;
    }
  }

  /** Start of a step: remember positions for render interpolation. */
  capture(): void {
    for (const frag of this.objects) capture(frag);
  }

  update(dt: number): void {
    const D = DEBRIS;
    const focus = this.world.focus;
    const drag = Math.exp(-D.drag * dt);
    const despawnSq = (D.despawnDistance * focus.view.targetDistance) ** 2;
    for (const frag of this.objects) {
      if (!frag.active) continue;
      frag.age += dt;

      if (frag.state === 'eating') {
        frag.eatProgress += dt / frag.infallTime;
        if (frag.eatProgress >= 1) frag.active = false;
        continue;
      }
      frag.position.x += frag.velocity.x * dt;
      frag.position.z += frag.velocity.z * dt;
      frag.velocity.x *= drag;
      frag.velocity.z *= drag;
      frag.heat = Math.exp(-D.coolRate * frag.age);
      const dx = frag.position.x - focus.position.x;
      const dz = frag.position.z - focus.position.z;
      const left = D.lifetime - frag.age;
      if (left <= 0 || dx * dx + dz * dz > despawnSq) {
        frag.active = false;
        continue;
      }
      frag.appear = Math.min(1, left / D.fadeTime);
      if (frag.age >= D.pickupDelay) this.world.feedOn(frag, frag.ownerId);
    }
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
}
