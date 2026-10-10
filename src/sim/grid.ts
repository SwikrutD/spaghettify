import type { Vec2 } from './vec.ts';

/** Something with a place and a size on the play plane. */
export interface GridItem {
  readonly position: Vec2;
  radius: number;
}

/** One level of the grid: square cells over [-half, half]^2 holding item indices by centre (a counting sort). */
class GridLevel {
  readonly cell: number;
  readonly cols: number;
  /** Items in cell c are items[start[c]] up to items[start[c + 1]]. */
  readonly start: Int32Array;
  readonly items: Int32Array;
  /** Largest radius of an item in this level at the last rebuild. */
  maxRadius = 0;

  constructor(cell: number, half: number, capacity: number) {
    this.cell = cell;
    this.cols = Math.max(1, Math.ceil((half * 2) / cell));
    this.start = new Int32Array(this.cols * this.cols + 1);
    this.items = new Int32Array(capacity);
  }
}

/**
 * Uniform spatial grid over a pool of items (bodies), rebuilt from scratch whenever they move. Levels of
 * different cell sizes keep queries tight across a huge range of sizes: an item goes into the first level whose
 * cell is at least twice its radius (the last level takes the rest), and a query visits, per level, only the cells
 * a circle grown by that level's largest radius can touch. Items outside the square land in its edge cells.
 * No allocations after construction.
 */
export class SpatialGrid {
  private readonly half: number;
  private readonly levels: GridLevel[];
  /** Level of each item at the last rebuild, -1 if left out. */
  private readonly levelOf: Int8Array;
  /** Cell of each item at the last rebuild. */
  private readonly cellOf: Int32Array;
  private items: readonly GridItem[] = [];

  /** `half`: half the side of the covered square; `cells`: cell side per level, smallest first; `capacity`: most items. */
  constructor(half: number, cells: readonly number[], capacity: number) {
    this.half = half;
    this.levels = cells.map((c) => new GridLevel(c, half, capacity));
    this.levelOf = new Int8Array(capacity);
    this.cellOf = new Int32Array(capacity);
  }

  /** Re-sort `items` (at most the capacity) into the cells. `include(i)` false leaves item i out. */
  rebuild(items: readonly GridItem[], include: (i: number) => boolean): void {
    this.items = items;
    const levels = this.levels;
    for (const level of levels) {
      level.start.fill(0);
      level.maxRadius = 0;
    }
    for (let i = 0; i < items.length; i++) {
      if (!include(i)) {
        this.levelOf[i] = -1;
        continue;
      }
      const item = items[i];
      let l = 0;
      while (l < levels.length - 1 && item.radius * 2 > levels[l].cell) l++;
      const level = levels[l];
      const c = this.cellIndex(level, item.position.x, item.position.z);
      this.levelOf[i] = l;
      this.cellOf[i] = c;
      level.start[c + 1]++;
      if (item.radius > level.maxRadius) level.maxRadius = item.radius;
    }
    for (const level of levels) {
      const start = level.start;
      for (let c = 1; c < start.length; c++) start[c] += start[c - 1];
    }
    // Second pass: place each item at the next free spot of its cell (start[c] runs ahead, then is restored).
    for (let i = 0; i < items.length; i++) {
      const l = this.levelOf[i];
      if (l < 0) continue;
      const level = levels[l];
      level.items[level.start[this.cellOf[i]]++] = i;
    }
    for (const level of levels) {
      const start = level.start;
      for (let c = start.length - 1; c > 0; c--) start[c] = start[c - 1];
      start[0] = 0;
    }
  }

  /**
   * Indices of the items whose centre is within `reach + k * radius` of (x, z), written to `out`; returns how
   * many. `k` sizes the test with each item (1 for overlap with a circle of radius `reach`, 4 for "within four
   * of its own radii"). `out` must hold as many indices as there are items.
   */
  query(x: number, z: number, reach: number, k: number, out: Int32Array): number {
    let n = 0;
    const items = this.items;
    for (const level of this.levels) {
      const grow = reach + k * level.maxRadius;
      const c0 = this.col(level, x - grow);
      const c1 = this.col(level, x + grow);
      const r0 = this.col(level, z - grow);
      const r1 = this.col(level, z + grow);
      for (let row = r0; row <= r1; row++) {
        for (let col = c0; col <= c1; col++) {
          const c = row * level.cols + col;
          for (let s = level.start[c], e = level.start[c + 1]; s < e; s++) {
            const i = level.items[s];
            const item = items[i];
            const dx = item.position.x - x;
            const dz = item.position.z - z;
            const limit = reach + k * item.radius;
            if (dx * dx + dz * dz < limit * limit) out[n++] = i;
          }
        }
      }
    }
    return n;
  }

  private col(level: GridLevel, v: number): number {
    const c = Math.floor((v + this.half) / level.cell);
    return c < 0 ? 0 : c >= level.cols ? level.cols - 1 : c;
  }

  private cellIndex(level: GridLevel, x: number, z: number): number {
    return this.col(level, z) * level.cols + this.col(level, x);
  }
}
