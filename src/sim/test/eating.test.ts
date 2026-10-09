import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PREY, TIERS, tierMinRadius } from '../../config/index.ts';
import type { AteEvent, SimEvent } from '../events.ts';
import { massOfRadius } from '../Hole.ts';
import { calmWorld, distance, placeBody, run, setMass, step } from './helpers.ts';

const ate = (events: SimEvent[]) => events.filter((e): e is AteEvent => e.type === 'ate');

test('a hole eats an edible body it touches: mass and score go up at once, then the body falls in and its slot respawns', () => {
  const world = calmWorld(3);
  const hole = world.focus;
  const start = hole.mass;
  const body = placeBody(world, 0, 0.3, hole.position.x + 0.2, hole.position.z);
  const name = body.className;
  const gen = body.gen;

  const meals = ate(step(world));
  assert.equal(meals.length, 1);
  assert.equal(body.state, 'eating');
  assert.equal(body.eaterId, hole.id);
  assert.ok(Math.abs(hole.mass - (start + massOfRadius(0.3))) < 1e-12);
  assert.ok(Math.abs(hole.eatenMass - massOfRadius(0.3)) < 1e-12);
  assert.equal(hole.eatenCount, 1);
  assert.deepEqual(hole.biggestEaten, { name, radius: 0.3 });
  assert.deepEqual(meals[0].what, { name, radius: 0.3 });
  assert.equal(meals[0].biggest, true);
  assert.equal(meals[0].reclaimed, false);
  assert.equal(meals[0].hole, hole.id);

  // The infall runs its course, then the slot holds a new body off on the respawn ring.
  run(world, body.infallTime + 0.05);
  assert.equal(body.gen, gen + 1);
  assert.equal(body.state, 'alive');
  assert.ok(distance(body, hole) > PREY.respawnInner * hole.view.targetDistance * 0.9);
});

test('a smaller meal after a bigger one is not the biggest; a body too big to swallow is never eaten', () => {
  const world = calmWorld(4);
  const hole = world.focus;
  placeBody(world, 0, 0.3, hole.position.x + 0.1, hole.position.z);
  step(world);
  placeBody(world, 1, 0.1, hole.position.x - 0.1, hole.position.z);
  const second = ate(step(world));
  assert.equal(second.length, 1);
  assert.equal(second[0].biggest, false);
  assert.equal(hole.biggestEaten?.radius, 0.3);

  // Dangers off so the big body does not knock the hole away: it simply sits there uneaten.
  world.dangers.enabled = false;
  const big = placeBody(world, 2, hole.radius * 2, hole.position.x, hole.position.z);
  const count = hole.eatenCount;
  run(world, 0.5);
  assert.equal(big.state, 'alive');
  assert.equal(hole.eatenCount, count);
});

test('the radius follows the mass smoothly and settles on the mass curve', () => {
  const world = calmWorld(5);
  const hole = world.focus;
  hole.mass = 1;
  let last = hole.radius;
  for (let i = 0; i < 120; i++) {
    step(world);
    assert.ok(hole.radius >= last);
    last = hole.radius;
  }
  assert.ok(Math.abs(hole.radius - hole.radiusForMass()) < 1e-3);
  assert.ok(Math.abs(hole.radiusForMass() - 1) < 1e-12);
});

test('crossing a tier threshold swaps the prey table, pulls the view out and dips time for a moment', () => {
  const world = calmWorld(6);
  const hole = world.focus;
  hole.hunger.enabled = false;
  setMass(hole, TIERS[1].minMass - 0.05);
  placeBody(world, 0, 1, hole.position.x + 0.5, hole.position.z);
  const events = run(world, world.dt * 2);
  const tiers = events.filter((e) => e.type === 'tier');
  assert.deepEqual(tiers, [{ type: 'tier', hole: hole.id, index: 1 }]);
  assert.equal(hole.tier, 1);
  assert.equal(world.prey.liveCount, TIERS[1].count);
  assert.equal(hole.view.tierScaleTarget, TIERS[1].cameraScale);
  const minRadius = tierMinRadius(TIERS[1]);
  for (const obj of world.prey.objects.slice(0, TIERS[1].count)) if (obj.state === 'alive') assert.ok(obj.radius >= minRadius);

  // Slow motion: game time runs slower than the steps for under a second, then back to normal.
  const runTime = hole.hunger.runTime;
  run(world, 0.3);
  assert.ok(world.timeScale < 1);
  assert.ok(hole.hunger.runTime - runTime < 0.3 * 0.75);
  run(world, 0.7);
  assert.equal(world.timeScale, 1);
});

test('two holes: each moves by its own input and eats what it touches', () => {
  const world = calmWorld(7);
  const a = world.focus;
  const b = world.addHole(5, 0);
  b.input.z = 1;
  run(world, 1);
  assert.ok(b.position.z > 3);
  assert.ok(Math.abs(b.position.x - 5) < 0.5);
  assert.ok(Math.hypot(a.position.x, a.position.z) < 0.1);

  const body = placeBody(world, 0, 0.3, b.position.x + 0.1, b.position.z);
  const meals = ate(step(world));
  assert.equal(meals.length, 1);
  assert.equal(meals[0].hole, b.id);
  assert.equal(body.eaterId, b.id);
  assert.equal(b.eatenCount, 1);
  assert.equal(a.eatenCount, 0);
});
