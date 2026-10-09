import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HUNGER } from '../../config/index.ts';
import { calmWorld, holdComets, placeBody, run, step } from './helpers.ts';

test('mass holds through the grace time while the warning builds, then drains; a meal resets the clock', () => {
  const world = calmWorld(31);
  const hole = world.focus;
  const start = hole.mass;
  run(world, HUNGER.graceTime - 0.2, () => holdComets(world));
  assert.equal(hole.mass, start);
  assert.ok(hole.hunger.level > 0.2 && hole.hunger.level <= 0.4);
  assert.equal(hole.phase, 'playing');

  run(world, 2, () => holdComets(world));
  assert.ok(hole.mass < start * 0.99);
  assert.ok(hole.hunger.level > 0.4);

  // A meal: the next step starts the clock again.
  placeBody(world, 0, 0.2, hole.position.x + 0.1, hole.position.z);
  step(world);
  step(world);
  assert.ok(hole.hunger.idle < world.dt * 1.5);
});

test('at the floor the hole evaporates on real time, its life ends with one died event, and it no longer eats or steers', () => {
  const world = calmWorld(32);
  const hole = world.focus;
  hole.hunger.idle = 100;
  hole.mass = hole.hunger.floorMass * 1.01;
  const toEvaporate = run(world, 0.5, () => holdComets(world));
  assert.equal(hole.phase, 'evaporating');
  assert.equal(toEvaporate.filter((e) => e.type === 'died').length, 0);

  const body = placeBody(world, 0, 0.1, hole.position.x, hole.position.z);
  hole.input.x = 1;
  const events = run(world, HUNGER.evaporateTime + 0.5, () => holdComets(world));
  assert.equal(hole.phase, 'over');
  assert.deepEqual(events.filter((e) => e.type === 'died'), [{ type: 'died', hole: hole.id }]);
  assert.equal(body.state, 'alive');
  assert.equal(hole.eatenCount, 0);
  assert.ok(Math.abs(hole.velocity.x) < 1e-9);
  assert.ok(hole.mass >= hole.hunger.floorMass * HUNGER.evaporateFloorFraction - 1e-12);

  // Over: nothing changes the score any more and no second died event comes.
  const runTime = hole.hunger.runTime;
  const later = run(world, 1, () => holdComets(world));
  assert.equal(later.filter((e) => e.type === 'died').length, 0);
  assert.equal(hole.hunger.runTime, runTime);
});

test('a hit lowers the floor so it never ends a life by itself, and hunger off means no drain', () => {
  const world = calmWorld(33);
  const hole = world.focus;
  hole.mass = hole.startMass * 4;
  hole.hunger.idle = 100;
  step(world);
  // Just above the floor, then a hit: the floor drops below what is left and the hole lives on.
  hole.mass = hole.hunger.floorMass * 1.02;
  hole.radius = hole.radiusForMass();
  placeBody(world, 0, hole.radius * 4, hole.position.x + hole.radius * 4, hole.position.z);
  step(world);
  assert.equal(hole.hits, 1);
  assert.ok(hole.hunger.floorMass < hole.mass * 0.85);
  assert.equal(hole.phase, 'playing');

  const calm = calmWorld(34);
  const off = calm.focus;
  off.hunger.enabled = false;
  off.hunger.idle = 100;
  const mass = off.mass;
  run(calm, 2, () => holdComets(calm));
  assert.equal(off.mass, mass);
  assert.equal(off.hunger.level, 0);
});
