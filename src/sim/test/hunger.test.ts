import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HUNGER } from '../../config/index.ts';
import { hawkingRate } from '../Hunger.ts';
import { holeMassForRadius } from '../Hole.ts';
import { calmWorld, clearBodies, holdComets, placeBody, run, setMass, step } from './helpers.ts';

test('mass holds through the grace time while the warning builds, then drains; a meal resets the clock', () => {
  const world = calmWorld(31);
  const hole = world.focus;
  const start = hole.mass;
  run(world, HUNGER.graceTime - 0.2, () => holdComets(world));
  // A pea feels no Hawking decay: it only loses mass by starving.
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

test('Hawking decay scales with size: a big hole loses a bigger share of its mass every second, fed or not', () => {
  assert.ok(hawkingRate(100) > hawkingRate(20) * 4);
  assert.equal(hawkingRate(0.5), 0);

  const world = calmWorld(35);
  const small = world.focus;
  const big = world.addHole(0, -400);
  setMass(small, holeMassForRadius(5));
  setMass(big, holeMassForRadius(80));
  clearBodies(world);
  const before = { small: small.mass, big: big.mass };
  // Inside the grace time (no starvation yet): only the size-scaled decay acts.
  run(world, 3, () => holdComets(world));
  const lostSmall = 1 - small.mass / before.small;
  const lostBig = 1 - big.mass / before.big;
  assert.ok(lostBig > lostSmall * 10, `${lostBig} vs ${lostSmall}`);
  assert.ok(Math.abs(lostBig - (1 - Math.exp(-hawkingRate(80) * 3))) < 0.01);
  assert.equal(big.phase, 'playing');
});

test('a tiny starving hole evaporates on time, its life ends with one died event, and it no longer eats or steers', () => {
  const world = calmWorld(32);
  const hole = world.focus;
  hole.hunger.idle = 100;
  // From the start mass, starving at full strength: about ln(2) / starveRate seconds to the evaporation mass.
  const expected = Math.log(hole.mass / hole.hunger.floorMass) / HUNGER.starveRate;
  const toEvaporate = run(world, expected + 0.3, () => holdComets(world));
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

test('a big starving hole shrinks fast but lives on for a long while; its score keeps the peak', () => {
  const world = calmWorld(36);
  const hole = world.focus;
  setMass(hole, holeMassForRadius(40));
  hole.peakMass = hole.mass;
  clearBodies(world);
  const score = hole.score;
  hole.hunger.idle = 100;
  run(world, 12, () => holdComets(world));
  assert.ok(hole.mass < hole.peakMass * 0.4);
  assert.equal(hole.phase, 'playing');
  assert.equal(hole.score, score);
});

test('a hit never ends a life (it never takes a hole below its start mass), and hunger off means no decay at all', () => {
  const world = calmWorld(33);
  const hole = world.focus;
  hole.hunger.idle = 100;
  setMass(hole, hole.startMass * 1.05);
  placeBody(world, 0, hole.radius * 4, hole.position.x + hole.radius * 4, hole.position.z);
  step(world);
  assert.equal(hole.hits, 1);
  assert.ok(hole.mass >= hole.startMass * 0.99);
  assert.ok(hole.mass > hole.hunger.floorMass);
  assert.equal(hole.phase, 'playing');

  const calm = calmWorld(34);
  const off = calm.focus;
  setMass(off, holeMassForRadius(60));
  off.hunger.enabled = false;
  off.hunger.idle = 100;
  const mass = off.mass;
  run(calm, 2, () => holdComets(calm));
  assert.equal(off.mass, mass);
  assert.equal(off.hunger.level, 0);
});
