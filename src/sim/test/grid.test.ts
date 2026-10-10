import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpatialGrid, type GridItem } from '../grid.ts';
import { Rng } from '../rng.ts';

/** Items of wildly mixed sizes (dust to giants) scattered over a square, some outside it. */
function scatter(rng: Rng, n: number, half: number): GridItem[] {
  const items: GridItem[] = [];
  for (let i = 0; i < n; i++) {
    items.push({ position: { x: rng.range(-half * 1.1, half * 1.1), z: rng.range(-half * 1.1, half * 1.1) }, radius: rng.logUniform(0.1, 250) });
  }
  return items;
}

function brute(items: GridItem[], include: (i: number) => boolean, x: number, z: number, reach: number, k: number): number[] {
  const out: number[] = [];
  items.forEach((it, i) => {
    if (!include(i)) return;
    const limit = reach + k * it.radius;
    if ((it.position.x - x) ** 2 + (it.position.z - z) ** 2 < limit * limit) out.push(i);
  });
  return out;
}

test('grid queries find exactly what a brute force search finds, at every size and reach, and skip left-out items', () => {
  const rng = new Rng(77);
  const half = 1200;
  const items = scatter(rng, 600, half);
  const grid = new SpatialGrid(half, [16, 128, 1024], items.length);
  const include = (i: number) => i % 7 !== 3;
  grid.rebuild(items, include);
  const out = new Int32Array(items.length);
  let found = 0;
  for (let q = 0; q < 400; q++) {
    const x = rng.range(-half * 1.2, half * 1.2);
    const z = rng.range(-half * 1.2, half * 1.2);
    const reach = rng.logUniform(0.5, 600);
    const k = [0, 0.25, 1, 4][q % 4];
    const n = grid.query(x, z, reach, k, out);
    const got = Array.from(out.subarray(0, n)).sort((a, b) => a - b);
    assert.deepEqual(got, brute(items, include, x, z, reach, k));
    found += n;
  }
  // The queries were not trivially empty.
  assert.ok(found > 400);
});

test('a rebuild follows moved items; an empty grid finds nothing', () => {
  const items: GridItem[] = [
    { position: { x: 0, z: 0 }, radius: 1 },
    { position: { x: 500, z: 500 }, radius: 40 },
  ];
  const grid = new SpatialGrid(1000, [8, 256], 2);
  const out = new Int32Array(2);
  grid.rebuild(items, () => true);
  assert.equal(grid.query(0, 0, 2, 1, out), 1);
  assert.equal(out[0], 0);
  items[0].position.x = 480;
  items[0].position.z = 470;
  // Not rebuilt yet: still sorted where it was, and no longer near the origin.
  assert.equal(grid.query(0, 0, 2, 1, out), 0);
  grid.rebuild(items, () => true);
  assert.equal(grid.query(490, 490, 25, 1, out), 2);
  grid.rebuild(items, () => false);
  assert.equal(grid.query(490, 490, 5000, 1, out), 0);
});
