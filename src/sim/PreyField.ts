import { DANGER, PREY, PREY_POOL_SIZE, tierMinRadius, type PreyClass, type Tier } from '../config/index.ts';
import { canSwallow, capture, createBody, spawned, type Body } from './body.ts';
import { massOfRadius } from './Hole.ts';
import type { World } from './World.ts';

/**
 * Prey: a fixed pool of bodies. What spawns comes from the current tier's absolute prey table and entity
 * budget (the first `tier.count` slots are live), around the world's focus hole, at distances in its view
 * distance. Any hole that touches an edible body eats it and it falls in. Bodies never overlap each other:
 * overlapping pairs are pushed apart, and spawns avoid other bodies and keep big ones out of pull reach of the hole.
 */
export class PreyField {
  readonly objects: Body[] = [];
  private readonly world: World;
  private tier: Tier;

  constructor(world: World, tier: Tier) {
    this.world = world;
    this.tier = tier;
    for (let i = 0; i < PREY_POOL_SIZE; i++) {
      this.objects.push(createBody(tier.classes[0].color));
      this.respawn(i, PREY.initialInner, PREY.initialOuter, false);
    }
  }

  /** Live slots (the current tier's entity budget). */
  get liveCount(): number {
    return this.tier.count;
  }

  /** The live tier. Slots beyond the old budget join and leftovers too small for the new table are refilled across the view. */
  setTier(tier: Tier): void {
    const oldCount = this.tier.count;
    this.tier = tier;
    const minRadius = tierMinRadius(tier);
    for (let i = 0; i < tier.count; i++) {
      const obj = this.objects[i];
      if (i >= oldCount || (obj.state === 'alive' && obj.radius < minRadius)) this.respawn(i, PREY.initialInner, PREY.initialOuter, true);
    }
  }

  /** Start of a new run: refill the whole pool across the view from the given tier's table. */
  reset(tier: Tier): void {
    this.tier = tier;
    // Park everything far away first so the refill does not dodge the last run's bodies.
    for (const obj of this.objects) {
      obj.position.x = 1e9;
      obj.position.z = 1e9;
    }
    for (let i = 0; i < PREY_POOL_SIZE; i++) this.respawn(i, PREY.initialInner, PREY.initialOuter, false);
  }

  /** Start of a step: remember positions for render interpolation. */
  capture(): void {
    for (const obj of this.objects) capture(obj);
  }

  update(dt: number): void {
    const focus = this.world.focus;
    const view = focus.view.targetDistance;
    const despawnSq = (PREY.despawnDistance * view) ** 2;
    const respawnSq = (PREY.respawnInner * view) ** 2;
    // Specks the focus hole has outgrown are recycled once they are off screen.
    const staleRadius = focus.radius * PREY.minRelSize;

    for (let i = 0; i < this.tier.count; i++) {
      const obj = this.objects[i];
      if (obj.state === 'eating') {
        obj.eatProgress += dt / obj.infallTime;
        if (obj.eatProgress >= 1) this.respawn(i, PREY.respawnInner, PREY.respawnOuter, true);
        continue;
      }
      obj.position.x += obj.velocity.x * dt;
      obj.position.z += obj.velocity.z * dt;
      obj.appear = Math.min(1, obj.appear + dt / PREY.appearTime);

      const dx = obj.position.x - focus.position.x;
      const dz = obj.position.z - focus.position.z;
      const distSq = dx * dx + dz * dz;
      const outOfSight = distSq > respawnSq;
      if (distSq > despawnSq || (outOfSight && obj.radius < staleRadius)) {
        this.respawn(i, PREY.respawnInner, PREY.respawnOuter, true);
      } else {
        this.world.feedOn(obj);
      }
    }

    this.separate(dt);
  }

  /** Push overlapping live bodies apart, the lighter one moving more. O(n^2) over at most PREY_POOL_SIZE bodies, no allocations. */
  private separate(dt: number): void {
    const k = Math.min(1, DANGER.separationRate * dt);
    const n = this.tier.count;
    for (let i = 0; i < n; i++) {
      const a = this.objects[i];
      if (a.state !== 'alive') continue;
      for (let j = i + 1; j < n; j++) {
        const b = this.objects[j];
        if (b.state !== 'alive') continue;
        const dx = b.position.x - a.position.x;
        const dz = b.position.z - a.position.z;
        const min = (a.radius + b.radius) * DANGER.bodyPad;
        const distSq = dx * dx + dz * dz;
        if (distSq >= min * min) continue;
        const dist = Math.sqrt(distSq);
        // Exactly on top of each other: pick any direction.
        const nx = dist > 1e-6 ? dx / dist : 1;
        const nz = dist > 1e-6 ? dz / dist : 0;
        const push = (min - dist) * k;
        const wa = b.mass / (a.mass + b.mass);
        a.position.x -= nx * push * wa;
        a.position.z -= nz * push * wa;
        b.position.x += nx * push * (1 - wa);
        b.position.z += nz * push * (1 - wa);
      }
    }
  }

  /** Reuse pool slot i as a fresh object from the current tier's table in an annulus around the focus hole (distances are in view distances). */
  private respawn(i: number, innerRel: number, outerRel: number, animate: boolean): void {
    const obj = this.objects[i];
    const rng = this.world.rng;
    const hole = this.world.focus;
    const pr = hole.radius;
    const view = hole.view.targetDistance;

    const cls = this.pickClass(pr * PREY.minRelSize, obj);
    obj.className = cls.name;
    obj.round = cls.round ?? false;
    obj.color = cls.color;
    obj.mass = massOfRadius(obj.radius);
    obj.appear = animate ? 0 : 1;

    // Uniform over the annulus area. Keep clear of the hole so spawning never overlaps it, and keep bodies
    // the hole cannot eat out of their pull reach where the annulus allows (huge ones end up at its outer edge).
    const outer = outerRel * view;
    let clear = pr + obj.radius * 1.5;
    if (!canSwallow(obj.radius, pr)) clear = Math.max(clear, Math.min(outer, obj.radius * DANGER.pullReach + pr * (1 + DANGER.spawnClearance)));
    const minDist = Math.max(innerRel * view, clear);
    const maxDist = Math.max(outer, minDist + pr);
    // A few tries to land clear of the other bodies; the separation pass sorts out the rare miss.
    for (let attempt = 0; attempt < DANGER.spawnTries; attempt++) {
      const dist = Math.sqrt(minDist * minDist + rng.next() * (maxDist * maxDist - minDist * minDist));
      const angle = rng.next() * Math.PI * 2;
      obj.position.x = hole.position.x + Math.cos(angle) * dist;
      obj.position.z = hole.position.z + Math.sin(angle) * dist;
      if (!this.overlapsOther(i)) break;
    }

    const driftAngle = rng.next() * Math.PI * 2;
    const drift = rng.next() * PREY.driftSpeed * view;
    obj.velocity.x = Math.cos(driftAngle) * drift;
    obj.velocity.z = Math.sin(driftAngle) * drift;
    spawned(obj, rng);
  }

  /** True if slot i overlaps another live body (other slots that exist yet). */
  private overlapsOther(i: number): boolean {
    const a = this.objects[i];
    const n = Math.min(this.tier.count, this.objects.length);
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const b = this.objects[j];
      if (b.state !== 'alive') continue;
      const min = (a.radius + b.radius) * DANGER.bodyPad;
      const dx = b.position.x - a.position.x;
      const dz = b.position.z - a.position.z;
      if (dx * dx + dz * dz < min * min) return true;
    }
    return false;
  }

  /**
   * Draw a class by weight and a radius within it, and store the radius on `obj`. Samples below
   * `minRadius` (specks next to the current hole) are redrawn a few times so the screen stays full of useful prey.
   */
  private pickClass(minRadius: number, obj: Body): PreyClass {
    const rng = this.world.rng;
    const classes = this.tier.classes;
    let total = 0;
    for (const c of classes) total += c.weight;
    let cls = classes[0];
    for (let attempt = 0; attempt < 8; attempt++) {
      let roll = rng.next() * total;
      cls = classes[classes.length - 1];
      for (const c of classes) {
        roll -= c.weight;
        if (roll <= 0) {
          cls = c;
          break;
        }
      }
      obj.radius = rng.logUniform(cls.radius[0], cls.radius[1]);
      if (obj.radius >= minRadius) break;
    }
    return cls;
  }
}
