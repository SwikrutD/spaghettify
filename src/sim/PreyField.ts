import { ARENA, BODIES, DANGER, PREY } from '../config/index.ts';
import { canSwallow, capture, createBody, spawned, type Body } from './body.ts';
import { SpatialGrid } from './grid.ts';
import { massOfRadius, viewDistance } from './Hole.ts';
import type { World } from './World.ts';

/**
 * The arena's individual bodies: dwarf planets, moons, planets and giants, a fixed population per class
 * (BODIES), scattered across the whole arena. Each pool slot keeps its class. An eaten body falls into its hole and
 * the slot respawns somewhere else in the arena, out of sight of every hole and clear of other bodies, so the
 * population holds; while no such place exists (a hole big enough to see most of the arena) it waits, gone.
 * Bodies sit still; overlapping ones are pushed apart. Queries go through a spatial grid that is rebuilt every step.
 */
export class PreyField {
  readonly objects: Body[] = [];
  /** Class of each slot (index into BODIES.classes). */
  readonly classOf: Uint8Array;
  /** The grid over the live bodies, as of the end of the last step. */
  readonly grid: SpatialGrid;
  /** Results of the last query: indices into objects. */
  readonly found: Int32Array;
  /** World time a gone slot tries to respawn again. */
  private readonly retryAt: Float32Array;
  /** Where each slot covered the field when it was placed (x, z, radius), to uncover the same patch later. */
  private readonly covers: Float64Array;
  private readonly world: World;
  private readonly isAlive = (i: number) => this.objects[i].state === 'alive';

  constructor(world: World) {
    this.world = world;
    const classes = BODIES.classes;
    const total = classes.reduce((n, c) => n + c.count, 0);
    this.classOf = new Uint8Array(total);
    for (let c = 0; c < classes.length; c++) {
      for (let k = 0; k < classes[c].count; k++) {
        const body = createBody(classes[c].color);
        body.className = classes[c].name;
        body.round = classes[c].round ?? false;
        this.classOf[this.objects.length] = c;
        this.objects.push(body);
      }
    }
    this.grid = new SpatialGrid(ARENA.radius + ARENA.edgeMargin, ARENA.gridLevels, total);
    this.found = new Int32Array(total);
    this.retryAt = new Float32Array(total);
    this.covers = new Float64Array(total * 3);
  }

  /** Bodies in play (alive or falling in); the rest wait to respawn. */
  get liveCount(): number {
    let n = 0;
    for (const obj of this.objects) if (obj.state !== 'gone') n++;
    return n;
  }

  /** A fresh arena: every body placed anew, clear of the holes there are. */
  reset(): void {
    this.covers.fill(0);
    for (const obj of this.objects) {
      obj.state = 'alive';
      obj.position.x = obj.position.z = 1e9;
    }
    // Biggest first: a giant needs a wide clear patch, which a field already full of small bodies would not have.
    const order = this.objects.map((_, i) => i).sort((a, b) => this.classOf[b] - this.classOf[a] || a - b);
    for (const i of order) this.respawn(i, true);
    this.rebuild();
  }

  /** Indices of the live bodies within `reach + k * radius` of (x, z) (see SpatialGrid.query), into `found`; returns how many. */
  query(x: number, z: number, reach: number, k: number): number {
    return this.grid.query(x, z, reach, k, this.found);
  }

  /** Start of a step: remember positions for render interpolation. */
  capture(): void {
    for (const obj of this.objects) capture(obj);
  }

  update(dt: number): void {
    for (let i = 0; i < this.objects.length; i++) {
      const obj = this.objects[i];
      if (obj.state === 'eating') {
        obj.eatProgress += dt / obj.infallTime;
        if (obj.eatProgress >= 1) this.respawn(i, false);
      } else if (obj.state === 'gone') {
        if (this.world.time >= this.retryAt[i]) this.respawn(i, false);
      } else if (obj.position.x * obj.position.x + obj.position.z * obj.position.z > ARENA.radius * ARENA.radius) {
        // Out of the arena (only something outside the rules puts it there): back in somewhere else.
        this.respawn(i, false);
      } else if (obj.appear < 1) {
        // A respawned body scales in.
        obj.appear = Math.min(1, obj.appear + dt / PREY.appearTime);
      }
    }
    this.separate(dt);
    this.recover();
    this.rebuild();
  }

  /** Bodies pushed off the patch they cover: hand the old patch back to the field and cover the new one. */
  private recover(): void {
    const field = this.world.field;
    for (let i = 0; i < this.objects.length; i++) {
      const obj = this.objects[i];
      const c = i * 3;
      if (obj.state !== 'alive' || this.covers[c + 2] === 0) continue;
      const moved = Math.hypot(obj.position.x - this.covers[c], obj.position.z - this.covers[c + 1]);
      if (moved < obj.radius * 0.02) continue;
      field.uncover(this.covers[c], this.covers[c + 1], this.covers[c + 2]);
      field.cover(obj);
      this.covers[c] = obj.position.x;
      this.covers[c + 1] = obj.position.z;
      this.covers[c + 2] = obj.radius;
    }
  }

  /** Re-sort the live bodies into the grid (after anything moved them). */
  rebuild(): void {
    this.grid.rebuild(this.objects, this.isAlive);
  }

  /** Push overlapping live bodies apart, the lighter one moving more. Neighbours come from the grid. */
  private separate(dt: number): void {
    const k = Math.min(1, DANGER.separationRate * dt);
    const objects = this.objects;
    for (let i = 0; i < objects.length; i++) {
      const a = objects[i];
      if (a.state !== 'alive') continue;
      const n = this.query(a.position.x, a.position.z, a.radius * DANGER.bodyPad, DANGER.bodyPad);
      for (let f = 0; f < n; f++) {
        const j = this.found[f];
        if (j <= i) continue;
        const b = objects[j];
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

  /**
   * Reuse slot i as a fresh body of its class somewhere in the arena. A respawn lands out of sight of every hole
   * (ARENA.holeClearViews of its view distance) or, if a few random tries find no such place, waits gone and tries
   * again later. The initial fill only keeps clear of each hole's reach. Either way a body a hole cannot eat lands out
   * of its pull reach, and it avoids other bodies where it can.
   */
  private respawn(i: number, initial: boolean): void {
    const obj = this.objects[i];
    const world = this.world;
    const rng = world.rng;
    // Whatever was hidden under its old place grows back in time.
    const c = i * 3;
    if (this.covers[c + 2] > 0) world.field.uncover(this.covers[c], this.covers[c + 1], this.covers[c + 2]);
    this.covers[c + 2] = 0;
    const cls = BODIES.classes[this.classOf[i]];
    const r = rng.logUniform(cls.radius[0], cls.radius[1]);
    obj.className = cls.name;
    obj.round = cls.round ?? false;
    obj.color = cls.color;
    obj.radius = r;
    obj.mass = massOfRadius(r);
    obj.velocity.x = obj.velocity.z = 0;

    const spread = ARENA.radius - ARENA.edgeMargin - r;
    // The first try clear of the holes and of other bodies wins; else the clearest one clear of the holes.
    let clearX = 0;
    let clearZ = 0;
    let clearScore = -Infinity;
    let found = false;
    for (let attempt = 0; attempt < ARENA.respawnTries && !found; attempt++) {
      const d = Math.sqrt(rng.next()) * spread;
      const a = rng.next() * Math.PI * 2;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      const spare = this.holeClearance(x, z, r, initial);
      found = spare >= 0 && !this.overlapsOther(i, x, z, r);
      if (found || spare > clearScore) {
        clearScore = spare;
        clearX = x;
        clearZ = z;
      }
    }
    if (clearScore < 0 && !initial) {
      // Nowhere out of sight: wait.
      obj.state = 'gone';
      obj.eatProgress = 0;
      obj.eaterId = -1;
      this.retryAt[i] = world.time + ARENA.respawnRetry;
      return;
    }
    obj.position.x = clearX;
    obj.position.z = clearZ;
    obj.appear = initial ? 1 : 0;
    spawned(obj, rng);
    world.field.cover(obj);
    this.covers[c] = obj.position.x;
    this.covers[c + 1] = obj.position.z;
    this.covers[c + 2] = obj.radius;
  }

  /**
   * Smallest distance to spare from any hole in play (Infinity with none). A body a hole cannot eat also keeps out
   * of its own pull reach of it, so nothing pulls a hole from nowhere.
   */
  private holeClearance(x: number, z: number, r: number, initial: boolean): number {
    let best = Infinity;
    for (const hole of this.world.holes) {
      if (hole.absent) continue;
      let need = canSwallow(r, hole.radius) ? hole.radius + r * 1.5 : r * DANGER.pullReach + hole.radius * 2;
      if (!initial) need = Math.max(need, ARENA.holeClearViews * viewDistance(hole.radius) + r);
      const spare = Math.hypot(x - hole.position.x, z - hole.position.z) - need;
      if (spare < best) best = spare;
    }
    return best;
  }

  /** True if a body of radius r at (x, z) would overlap another live body than slot i. */
  private overlapsOther(i: number, x: number, z: number, r: number): boolean {
    const objects = this.objects;
    for (let j = 0; j < objects.length; j++) {
      if (j === i) continue;
      const b = objects[j];
      if (b.state !== 'alive') continue;
      const min = (r + b.radius) * DANGER.bodyPad;
      const dx = b.position.x - x;
      const dz = b.position.z - z;
      if (dx * dx + dz * dz < min * min) return true;
    }
    return false;
  }
}
