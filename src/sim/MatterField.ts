import { ARENA, FIELD, PREY, type FieldLayer } from '../config/index.ts';
import { canSwallow, capture, createBody, spawned, type Body } from './body.ts';
import { insideArena } from './arena.ts';
import { massOfRadius, viewDistance, type Hole } from './Hole.ts';
import { lerp } from './math.ts';
import { hash01, hash4 } from './rng.ts';
import type { World } from './World.ts';

/** One grain of the field, worked out from its layer, cell and slot. Visitors get a scratch Grain that is reused. */
export interface Grain {
  layer: number;
  cell: number;
  slot: number;
  x: number;
  z: number;
  radius: number;
  /** Look seed (colour, spin), the same for every client. */
  seed: number;
  /** World time its cell last grew back (very negative for the initial field): the renderer scales it in. */
  born: number;
}

/** Called for each grain a query finds. Return true to stop early. */
export type GrainVisitor = (g: Grain) => boolean | void;

/** A pooled eaten grain falling into its hole (a body, so it spaghettifies like any prey). */
export interface FieldInfall extends Body {
  active: boolean;
}

const NOT_WORKED_OUT = -1;
/** Born time of the initial field: long ago, so it is fully grown. */
const LONG_AGO = -1e6;

/** One layer's state: per cell, which slots hold a grain and which of those are gone. */
class Layer {
  readonly def: FieldLayer;
  readonly index: number;
  readonly cols: number;
  readonly slots: number;
  /** Side of one slot, and how far a grain keeps from its slot's sides (so grains never overlap). */
  readonly sub: number;
  readonly margin: number;
  readonly logLo: number;
  readonly logHi: number;
  /** Half the diagonal of a cell. */
  readonly halfDiag: number;
  /** Per cell: slots that hold a grain at the current epoch (NOT_WORKED_OUT until first needed). */
  readonly present: Int32Array;
  /** Per cell: slots taken (eaten, or covered by a body) since the cell last grew. */
  readonly taken: Uint16Array;
  /** Per cell: slots covered by a body (part of `taken`; they come back when the body goes, not by themselves). */
  readonly covered: Uint16Array;
  /** Per cell: times it has grown back. Part of each grain's hash, so a regrown cell is laid out afresh. */
  readonly epoch: Uint16Array;
  /** Per cell: world time it last grew back. */
  readonly born: Float32Array;
  /** Per cell: world time it may grow back; 0 = not waiting. */
  readonly regrowAt: Float32Array;
  /** Cells waiting to grow back, and where the round-robin check left off. */
  readonly waiting: number[] = [];
  cursor = 0;

  constructor(def: FieldLayer, index: number) {
    this.def = def;
    this.index = index;
    this.cols = Math.ceil((ARENA.radius * 2) / def.cell);
    this.slots = def.grid * def.grid;
    this.sub = def.cell / def.grid;
    this.margin = Math.min(def.radius[1] * 1.15, this.sub * 0.45);
    this.logLo = Math.log(def.radius[0]);
    this.logHi = Math.log(def.radius[1]);
    this.halfDiag = def.cell * Math.SQRT1_2;
    const cells = this.cols * this.cols;
    this.present = new Int32Array(cells);
    this.taken = new Uint16Array(cells);
    this.covered = new Uint16Array(cells);
    this.epoch = new Uint16Array(cells);
    this.born = new Float32Array(cells);
    this.regrowAt = new Float32Array(cells);
  }

  reset(): void {
    this.present.fill(NOT_WORKED_OUT);
    this.taken.fill(0);
    this.covered.fill(0);
    this.epoch.fill(0);
    this.born.fill(LONG_AGO);
    this.regrowAt.fill(0);
    this.waiting.length = 0;
    this.cursor = 0;
  }

  /** Column (or row) of a coordinate, clamped to the grid. */
  col(v: number): number {
    const c = Math.floor((v + ARENA.radius) / this.def.cell);
    return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
  }

  centreX(cell: number): number {
    return -ARENA.radius + ((cell % this.cols) + 0.5) * this.def.cell;
  }

  centreZ(cell: number): number {
    return -ARENA.radius + (Math.floor(cell / this.cols) + 0.5) * this.def.cell;
  }
}

/**
 * The procedural small matter: dust, pebbles, rocks, boulders, asteroids and small moons tiling the whole arena
 * in layers of cells (see FIELD). A grain's place, size and look are a pure hash of the world seed, its layer,
 * cell, slot and the cell's epoch, so the simulation only stores which grains are gone. Any hole that touches an
 * edible grain eats it (a falling body from a small pool carries the spaghettification); grains smaller than a
 * speck to that hole are swallowed on the way. Grains a hole cannot eat block it and the big ones pull it (see
 * Dangers). An eaten cell grows back, laid out afresh, after FIELD.regrowTime once no hole is near. Bodies cover
 * the grains under them.
 */
export class MatterField {
  /** Off: no grains anywhere (tests that need an empty arena). */
  enabled = true;
  readonly layers: readonly Layer[];
  readonly infall: FieldInfall[] = [];
  private readonly world: World;
  private readonly scratch: Grain = { layer: 0, cell: 0, slot: 0, x: 0, z: 0, radius: 0, seed: 0, born: 0 };
  /** Hole being fed, while feeding it. */
  private feeding: Hole | null = null;
  /** Body being covered, while covering grains under it. */
  private covering: Body | null = null;
  private readonly onFeed: GrainVisitor = (g) => {
    const hole = this.feeding!;
    if (!canSwallow(g.radius, hole.radius)) return;
    if (g.radius < hole.radius * PREY.minRelSize) {
      this.take(g);
      hole.absorb(massOfRadius(g.radius));
    } else {
      this.world.swallow(this.fall(g), hole);
    }
  };
  private readonly onCover: GrainVisitor = (g) => {
    const body = this.covering!;
    const layer = this.layers[g.layer];
    const dx = g.x - body.position.x;
    const dz = g.z - body.position.z;
    const r = g.radius + body.radius;
    if (dx * dx + dz * dz >= r * r) return;
    const bit = 1 << g.slot;
    layer.taken[g.cell] |= bit;
    layer.covered[g.cell] |= bit;
  };
  private readonly onClear: GrainVisitor = (g) => {
    this.take(g);
  };

  constructor(world: World) {
    this.world = world;
    this.layers = FIELD.layers.map((def, i) => new Layer(def, i));
    for (let i = 0; i < FIELD.infallPoolSize; i++) {
      const body: FieldInfall = Object.assign(createBody(FIELD.layers[0].color), { active: false });
      this.infall.push(body);
    }
    this.reset();
  }

  /** A fresh field: every grain in place, nothing falling. */
  reset(): void {
    for (const layer of this.layers) layer.reset();
    for (const body of this.infall) body.active = false;
  }

  /**
   * Call `visit` for every grain of layer `layerIndex` whose centre is within `reach + k * radius` of (x, z), until
   * it returns true. The Grain it gets is reused between calls.
   */
  forEach(layerIndex: number, x: number, z: number, reach: number, k: number, visit: GrainVisitor): void {
    if (!this.enabled) return;
    const layer = this.layers[layerIndex];
    const grow = reach + k * layer.def.radius[1];
    const c0 = layer.col(x - grow);
    const c1 = layer.col(x + grow);
    const r0 = layer.col(z - grow);
    const r1 = layer.col(z + grow);
    const g = this.scratch;
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const cell = row * layer.cols + col;
        const live = this.presentIn(layer, cell) & ~layer.taken[cell];
        if (live === 0) continue;
        for (let slot = 0; slot < layer.slots; slot++) {
          if ((live & (1 << slot)) === 0) continue;
          this.grain(layer, cell, slot, g);
          const dx = g.x - x;
          const dz = g.z - z;
          const limit = reach + k * g.radius;
          if (dx * dx + dz * dz >= limit * limit) continue;
          if (visit(g) === true) return;
        }
      }
    }
  }

  /** Grains left in a layer's cell (a bit per slot). */
  liveIn(layerIndex: number, cell: number): number {
    const layer = this.layers[layerIndex];
    return this.presentIn(layer, cell) & ~layer.taken[cell];
  }

  /** The hole eats every edible grain it touches; specks to it are swallowed on the way. */
  feed(hole: Hole): void {
    const r = hole.radius;
    this.feeding = hole;
    for (const layer of this.layers) {
      if (layer.def.radius[0] >= r * PREY.edibleRatio) break;
      this.forEach(layer.index, hole.position.x, hole.position.z, r, PREY.eatReach, this.onFeed);
    }
    this.feeding = null;
  }

  /** Remove a grain (eaten or cleared). Its cell will grow back later. */
  take(g: Grain): void {
    const layer = this.layers[g.layer];
    layer.taken[g.cell] |= 1 << g.slot;
    this.schedule(layer, g.cell);
  }

  /** Grains under a body are hidden (and out of play) while it is there. Call after placing the body. */
  cover(body: Body): void {
    this.covering = body;
    for (const layer of this.layers) this.forEach(layer.index, body.position.x, body.position.z, body.radius, 1, this.onCover);
    this.covering = null;
  }

  /** A body left this place (eaten or moved away): the cells under it grow back in time, laid out afresh. */
  uncover(x: number, z: number, radius: number): void {
    for (const layer of this.layers) {
      const grow = radius + layer.def.radius[1];
      for (let row = layer.col(z - grow); row <= layer.col(z + grow); row++) {
        for (let col = layer.col(x - grow); col <= layer.col(x + grow); col++) {
          const cell = row * layer.cols + col;
          if (layer.covered[cell] !== 0) this.schedule(layer, cell);
        }
      }
    }
  }

  /**
   * Take every grain whose radius is at least `minRadius` (0: all of them) and whose centre is within
   * `radius + k * its radius` of (x, z) (k = DANGER.pullReach clears whatever could pull a hole there).
   */
  clearAround(x: number, z: number, radius: number, minRadius = 0, k = 1): void {
    for (const layer of this.layers) {
      if (layer.def.radius[1] < minRadius) continue;
      this.forEach(layer.index, x, z, radius, k, minRadius > 0 ? (g) => void (g.radius >= minRadius && this.take(g)) : this.onClear);
    }
  }

  /** Start of a step: remember the falling grains' progress for render interpolation. */
  capture(): void {
    for (const body of this.infall) if (body.active) capture(body);
  }

  update(dt: number): void {
    for (const body of this.infall) {
      if (!body.active) continue;
      body.eatProgress += dt / body.infallTime;
      if (body.eatProgress >= 1) body.active = false;
    }
    for (const layer of this.layers) this.regrowWaiting(layer);
  }

  /** Grains falling right now. */
  get falling(): number {
    let n = 0;
    for (const body of this.infall) if (body.active) n++;
    return n;
  }

  /** Total number of grains left in the arena, per layer (slow: tests and tuning). */
  count(layerIndex: number): number {
    const layer = this.layers[layerIndex];
    let n = 0;
    for (let cell = 0; cell < layer.present.length; cell++) {
      let live = this.presentIn(layer, cell) & ~layer.taken[cell];
      while (live) {
        live &= live - 1;
        n++;
      }
    }
    return n;
  }

  /** Slots of a cell that hold a grain at its current epoch (worked out on first use, then kept). */
  private presentIn(layer: Layer, cell: number): number {
    let mask = layer.present[cell];
    if (mask !== NOT_WORKED_OUT) return mask;
    mask = 0;
    const g = this.scratch;
    for (let slot = 0; slot < layer.slots; slot++) {
      const h = this.hash(layer, cell, slot);
      if (hash01(h, 0) >= layer.def.fill) continue;
      this.grain(layer, cell, slot, g);
      if (insideArena(g.x, g.z, g.radius)) mask |= 1 << slot;
    }
    layer.present[cell] = mask;
    return mask;
  }

  private hash(layer: Layer, cell: number, slot: number): number {
    return hash4((this.world.seed ^ Math.imul(layer.index + 1, 0x27d4eb2d)) >>> 0, cell, slot, layer.epoch[cell]);
  }

  /** Work out the grain in a slot (whether or not it is present) into `out`. */
  private grain(layer: Layer, cell: number, slot: number, out: Grain): Grain {
    const h = this.hash(layer, cell, slot);
    const cell0 = layer.def.cell;
    const ox = -ARENA.radius + (cell % layer.cols) * cell0 + (slot % layer.def.grid) * layer.sub + layer.margin;
    const oz = -ARENA.radius + Math.floor(cell / layer.cols) * cell0 + Math.floor(slot / layer.def.grid) * layer.sub + layer.margin;
    const span = layer.sub - 2 * layer.margin;
    out.layer = layer.index;
    out.cell = cell;
    out.slot = slot;
    out.x = ox + hash01(h, 1) * span;
    out.z = oz + hash01(h, 2) * span;
    out.radius = Math.exp(lerp(layer.logLo, layer.logHi, hash01(h, 3)));
    out.seed = h;
    out.born = layer.born[cell];
    return out;
  }

  /** The cell is missing grains: it may grow back after a while. */
  private schedule(layer: Layer, cell: number): void {
    if (layer.regrowAt[cell] !== 0) return;
    layer.regrowAt[cell] = this.world.time + this.world.rng.range(FIELD.regrowTime[0], FIELD.regrowTime[1]);
    layer.waiting.push(cell);
  }

  /** Check a share of the waiting cells: those due grow back if no hole is near, the rest wait a little longer. */
  private regrowWaiting(layer: Layer): void {
    const waiting = layer.waiting;
    const now = this.world.time;
    let checks = Math.min(FIELD.regrowChecksPerStep, waiting.length);
    let i = layer.cursor;
    while (checks-- > 0 && waiting.length > 0) {
      if (i >= waiting.length) i = 0;
      const cell = waiting[i];
      if (now < layer.regrowAt[cell]) {
        i++;
        continue;
      }
      if (!this.clearOfHoles(layer, cell)) {
        layer.regrowAt[cell] = now + FIELD.regrowRetry;
        i++;
        continue;
      }
      this.regrow(layer, cell);
      waiting[i] = waiting[waiting.length - 1];
      waiting.pop();
    }
    layer.cursor = i;
  }

  private clearOfHoles(layer: Layer, cell: number): boolean {
    const x = layer.centreX(cell);
    const z = layer.centreZ(cell);
    for (const hole of this.world.holes) {
      if (hole.absent) continue;
      const clear = FIELD.regrowClearViews * viewDistance(hole.radius) + layer.halfDiag;
      const dx = hole.position.x - x;
      const dz = hole.position.z - z;
      if (dx * dx + dz * dz < clear * clear) return false;
    }
    return true;
  }

  /** The cell grows back laid out afresh, except where a body sits on it. */
  private regrow(layer: Layer, cell: number): void {
    layer.epoch[cell]++;
    layer.present[cell] = NOT_WORKED_OUT;
    layer.taken[cell] = 0;
    layer.covered[cell] = 0;
    layer.born[cell] = this.world.time;
    layer.regrowAt[cell] = 0;
    const prey = this.world.prey;
    const x = layer.centreX(cell);
    const z = layer.centreZ(cell);
    const n = prey.query(x, z, layer.halfDiag + layer.def.radius[1], 1);
    const g = this.scratch;
    const live = this.presentIn(layer, cell);
    for (let k = 0; k < n; k++) {
      const body = prey.objects[prey.found[k]];
      if (body.state !== 'alive') continue;
      for (let slot = 0; slot < layer.slots; slot++) {
        if ((live & (1 << slot)) === 0) continue;
        this.grain(layer, cell, slot, g);
        const dx = g.x - body.position.x;
        const dz = g.z - body.position.z;
        const r = g.radius + body.radius;
        if (dx * dx + dz * dz < r * r) {
          layer.taken[cell] |= 1 << slot;
          layer.covered[cell] |= 1 << slot;
        }
      }
    }
  }

  /** Take an eaten grain out of the field and hand back a pooled body standing in for it, ready to fall in. */
  private fall(g: Grain): FieldInfall {
    this.take(g);
    let body = this.infall.find((b) => !b.active);
    if (!body) {
      // Full pool: reuse the one furthest into its fall (it is nearly drained anyway).
      body = this.infall[0];
      for (const b of this.infall) if (b.eatProgress > body.eatProgress) body = b;
    }
    const def = this.layers[g.layer].def;
    body.active = true;
    body.className = def.name;
    body.round = def.round ?? false;
    body.color = def.color;
    body.radius = g.radius;
    body.mass = massOfRadius(g.radius);
    body.appear = 1;
    body.position.x = g.x;
    body.position.z = g.z;
    body.velocity.x = body.velocity.z = 0;
    spawned(body, this.world.rng);
    // The same look as the grain it stands in for.
    body.seed = g.seed;
    return body;
  }
}
