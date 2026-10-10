import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARENA, GROWTH, MILESTONES, PLAYER } from '../../config/index.ts';
import type { AteEvent, SimEvent } from '../events.ts';
import { massOfRadius, viewDistance } from '../Hole.ts';
import { canSwallow } from '../body.ts';
import { classNamed, MILESTONE_MASSES } from '../milestones.ts';
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
  assert.equal(hole.peakMass, hole.mass);
  assert.equal(hole.score, Math.round(massOfRadius(0.3) * 1000));
  assert.equal(hole.eatenCount, 1);
  assert.deepEqual(hole.biggestEaten, { name, radius: 0.3 });
  assert.deepEqual(meals[0].what, { name, radius: 0.3 });
  assert.equal(meals[0].biggest, true);
  assert.equal(meals[0].reclaimed, false);
  assert.equal(meals[0].hole, hole.id);

  // The infall runs its course, then the slot holds a new body of its class somewhere out of the hole's sight.
  run(world, body.infallTime + 0.05);
  assert.equal(body.gen, gen + 1);
  assert.equal(body.state, 'alive');
  assert.equal(body.className, name);
  assert.ok(distance(body, hole) > ARENA.holeClearViews * viewDistance(hole.radius));
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
  hole.hunger.enabled = false;
  hole.mass = 1;
  let last = hole.radius;
  for (let i = 0; i < 120; i++) {
    step(world);
    assert.ok(hole.radius >= last);
    last = hole.radius;
  }
  assert.ok(Math.abs(hole.radius - hole.radiusForMass()) < 1e-3);
  // Four times the start mass: the radius grows by 4 ^ radiusExponent (slower than the area would).
  assert.ok(Math.abs(hole.radiusForMass() - PLAYER.startRadius * Math.pow(4, GROWTH.radiusExponent)) < 1e-12);
});

test('crossing a size milestone is an event, once; nothing in the arena changes and time runs on', () => {
  const world = calmWorld(6);
  const hole = world.focus;
  hole.hunger.enabled = false;
  setMass(hole, MILESTONE_MASSES[1] - 0.01);
  const bodies = world.prey.objects.map((o) => ({ gen: o.gen, r: o.radius, name: o.className }));
  placeBody(world, 0, 0.3, hole.position.x + 0.3, hole.position.z);
  const time = world.time;
  const events = run(world, world.dt * 2);
  assert.deepEqual(
    events.filter((e) => e.type === 'milestone'),
    [{ type: 'milestone', hole: hole.id, index: 1 }],
  );
  assert.equal(hole.milestone, 1);
  assert.equal(MILESTONES[1].unlocks, 'rock');
  assert.ok(Math.abs(world.time - time - world.dt * 2) < 1e-9);
  // The arena is untouched: no other body was swapped for another or resized.
  for (let i = 1; i < bodies.length; i++) {
    const o = world.prey.objects[i];
    assert.deepEqual({ gen: o.gen, r: o.radius, name: o.className }, bodies[i]);
  }

  // Shrinking back below it and growing again does not replay it; skipping several at once reports the highest.
  setMass(hole, MILESTONE_MASSES[1] * 0.5);
  run(world, 0.2);
  setMass(hole, MILESTONE_MASSES[1] * 1.5);
  assert.equal(run(world, 0.2).filter((e) => e.type === 'milestone').length, 0);
  setMass(hole, MILESTONE_MASSES[4] * 1.01);
  assert.deepEqual(
    run(world, world.dt).filter((e) => e.type === 'milestone'),
    [{ type: 'milestone', hole: hole.id, index: 4 }],
  );
});

test('each milestone is where its class becomes food: just below it the largest member is not edible, just above it is', () => {
  const world = calmWorld(8);
  const hole = world.focus;
  for (let i = 1; i < MILESTONES.length; i++) {
    assert.ok(MILESTONE_MASSES[i] > MILESTONE_MASSES[i - 1]);
    const largest = classNamed(MILESTONES[i].unlocks!).radius[1];
    setMass(hole, MILESTONE_MASSES[i] * 0.999);
    assert.equal(canSwallow(largest, hole.radius), false, MILESTONES[i].title);
    setMass(hole, MILESTONE_MASSES[i] * 1.001);
    assert.equal(canSwallow(largest, hole.radius), true, MILESTONES[i].title);
  }
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
