import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEBRIS } from '../../config/index.ts';
import type { AteEvent, SimEvent } from '../events.ts';
import type { Fragment } from '../DebrisField.ts';
import type { Hole } from '../Hole.ts';
import type { World } from '../World.ts';
import { calmWorld, holdComets, placeBody, run, setMass, step } from './helpers.ts';

const ate = (events: SimEvent[]) => events.filter((e): e is AteEvent => e.type === 'ate');

/** Hit `hole` once against a big body (then clear the body away and stop the knockback). */
function hitOnce(world: World, hole: Hole): void {
  const body = placeBody(world, 0, hole.radius * 4, hole.position.x + hole.radius * 4, hole.position.z);
  step(world);
  assert.equal(hole.hits, 1);
  body.position.x += 1e6;
  hole.stun = 0;
  hole.velocity.x = hole.velocity.z = 0;
}

/** Sit `hole` on `frag` every step until it is swallowed (or give up after `steps`). Returns the events meanwhile. */
function chase(world: World, hole: Hole, frag: Fragment, steps = 60): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < steps && frag.state === 'alive' && frag.active; i++) {
    hole.velocity.x = hole.velocity.z = 0;
    hole.position.x = frag.position.x;
    hole.position.z = frag.position.z;
    events.push(...step(world));
  }
  return events;
}

test('debris cannot be eaten at once; later the hole eats it back for its mass but no score', () => {
  const world = calmWorld(21);
  const hole = world.focus;
  setMass(hole, hole.startMass * 9);
  hitOnce(world, hole);

  // Straight onto a fresh fragment: too hot to eat yet.
  const first = world.debris.objects.find((f) => f.active)!;
  hole.position.x = first.position.x;
  hole.position.z = first.position.z;
  step(world);
  step(world);
  assert.equal(first.state, 'alive');
  assert.equal(hole.eatenCount, 0);

  // After the pickup delay it is food again: the mass comes back, the score and the biggest meal do not change.
  while (world.debris.objects.some((f) => f.active && f.age < DEBRIS.pickupDelay)) step(world);
  const frag = world.debris.objects.find((f) => f.active && f.state === 'alive')!;
  const before = { mass: hole.mass, eatenMass: hole.eatenMass, count: hole.eatenCount };
  const meals = ate(chase(world, hole, frag));
  assert.equal(frag.state, 'eating');
  assert.ok(meals.length >= 1);
  let gained = 0;
  for (const m of meals) {
    assert.equal(m.hole, hole.id);
    assert.equal(m.reclaimed, true);
    assert.equal(m.biggest, false);
    gained += m.gained;
  }
  assert.ok(Math.abs(hole.mass - before.mass - gained) < 1e-12);
  assert.ok(gained >= frag.mass * 0.999);
  assert.equal(hole.eatenMass, before.eatenMass);
  assert.equal(hole.eatenCount, before.count + meals.length);
  assert.equal(hole.biggestEaten, null);
});

test("another hole eating a hole's debris scores it", () => {
  const world = calmWorld(22);
  const a = world.focus;
  setMass(a, a.startMass * 9);
  const b = world.addHole(0, -8);
  hitOnce(world, a);
  while (world.debris.objects.some((f) => f.active && f.age < DEBRIS.pickupDelay)) step(world);

  const frag = world.debris.objects.find((f) => f.active && f.state === 'alive')!;
  assert.equal(frag.ownerId, a.id);
  const meals = ate(chase(world, b, frag)).filter((m) => m.hole === b.id);
  assert.equal(frag.state, 'eating');
  assert.equal(frag.eaterId, b.id);
  assert.ok(meals.length >= 1);
  let gained = 0;
  for (const m of meals) {
    assert.equal(m.reclaimed, false);
    gained += m.gained;
  }
  assert.ok(Math.abs(b.eatenMass - gained) < 1e-12);
  assert.equal(b.biggestEaten?.name, 'debris');
});

test('a full pool reuses the oldest fragments, and fragments age out', () => {
  const world = calmWorld(23);
  const hole = world.focus;
  hole.hunger.enabled = false;
  const hits = Math.ceil(DEBRIS.poolSize / DEBRIS.perHit) + 1;
  for (let i = 0; i < hits; i++) world.debris.emit(hole, 1, 0, 0.1, 5);
  assert.equal(world.debris.emitted, hits * DEBRIS.perHit);
  assert.equal(world.debris.objects.filter((f) => f.active).length, DEBRIS.poolSize);

  // Out of the hole's reach they live out their lifetime, fade and are gone.
  for (const f of world.debris.objects) {
    f.velocity.x = f.velocity.z = 0;
    f.position.x = 6;
    f.position.z = 0;
  }
  run(world, DEBRIS.lifetime - 1, () => holdComets(world));
  assert.equal(world.debris.live, DEBRIS.poolSize);
  for (const f of world.debris.objects) assert.ok(f.appear < 1 && f.heat < 0.01);
  run(world, 1.5, () => holdComets(world));
  assert.equal(world.debris.live, 0);
});
