import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARENA, BODIES, DANGER, PREY } from '../../config/index.ts';
import { edgeWidth } from '../arena.ts';
import { canSwallow } from '../body.ts';
import { holeMassForRadius, topSpeed, viewDistance } from '../Hole.ts';
import { World } from '../World.ts';
import { calmWorld, distance, holdComets, run, setMass } from './helpers.ts';

test('a fresh arena holds every class at its population, spread over the whole disc and clear of the start', () => {
  const world = new World({ seed: 41 });
  const hole = world.focus;
  const objects = world.prey.objects;
  assert.equal(objects.length, BODIES.classes.reduce((n, c) => n + c.count, 0));
  for (const cls of BODIES.classes) {
    const members = objects.filter((o) => o.className === cls.name);
    assert.equal(members.length, cls.count);
    for (const o of members) assert.ok(o.radius >= cls.radius[0] && o.radius <= cls.radius[1]);
  }
  // Inside the arena and spread over it: every quadrant and both the inner and the outer half hold bodies.
  const quadrants = [0, 0, 0, 0];
  let outer = 0;
  for (const o of objects) {
    const d = Math.hypot(o.position.x, o.position.z);
    assert.ok(d + o.radius < ARENA.radius);
    quadrants[(o.position.x > 0 ? 1 : 0) + (o.position.z > 0 ? 2 : 0)]++;
    if (d > ARENA.radius * 0.7) outer++;
    // Nothing the start hole cannot eat within its pull reach.
    if (!canSwallow(o.radius, hole.radius)) assert.ok(distance(o, hole) > o.radius * DANGER.pullReach);
  }
  for (const q of quadrants) assert.ok(q > objects.length * 0.15);
  // Nothing pulls the hole where it starts: a still hole stays put.
  world.step();
  assert.equal(hole.pull.x, 0);
  assert.equal(hole.pull.z, 0);
  assert.ok(outer > objects.length * 0.3);
  // No two bodies overlap.
  for (let i = 0; i < objects.length; i++) {
    for (let j = i + 1; j < objects.length; j++) assert.ok(distance(objects[i], objects[j]) >= (objects[i].radius + objects[j].radius) * DANGER.bodyPad * 0.999);
  }
});

test('eaten bodies respawn across the whole arena, out of sight of every hole', () => {
  const world = calmWorld(42);
  const a = world.focus;
  const b = world.addHole(600, 0);
  a.hunger.enabled = b.hunger.enabled = false;
  const body = world.prey.objects[5];
  const places: { x: number; z: number }[] = [];
  for (let i = 0; i < 60; i++) {
    // Feed the body to hole a, then let it fall in and come back.
    body.radius = 0.3;
    body.position.x = a.position.x + 0.2;
    body.position.z = a.position.z;
    run(world, 1, () => holdComets(world));
    assert.equal(body.state, 'alive');
    // It scales in from nothing (it used to stay at scale 0: there but never drawn).
    assert.ok(body.appear > 0, 'a respawned body scales in');
    for (const hole of [a, b]) assert.ok(distance(body, hole) > ARENA.holeClearViews * viewDistance(hole.radius) + body.radius - 1e-9);
    places.push({ x: body.position.x, z: body.position.z });
    setMass(a, a.startMass);
  }
  run(world, PREY.appearTime + 0.05, () => holdComets(world));
  assert.equal(body.appear, 1);
  // Spread over the arena: far from the eater and far from each other on average.
  const meanDist = places.reduce((s, p) => s + Math.hypot(p.x, p.z), 0) / places.length;
  assert.ok(meanDist > ARENA.radius * 0.4, `${meanDist}`);
  const xs = places.map((p) => p.x);
  assert.ok(Math.max(...xs) - Math.min(...xs) > ARENA.radius);
});

test('with a hole that sees the whole arena, an eaten body waits out of play, then comes back once there is room', () => {
  const world = calmWorld(43);
  const hole = world.focus;
  hole.hunger.enabled = false;
  world.dangers.enabled = false;
  setMass(hole, holeMassForRadius(ARENA.radius));
  assert.ok(ARENA.holeClearViews * viewDistance(hole.radius) > ARENA.radius * 2);
  const body = world.prey.objects[0];
  body.position.x = hole.position.x;
  body.position.z = hole.position.z;
  run(world, 2, () => holdComets(world));
  assert.equal(body.state, 'gone');
  assert.equal(world.prey.liveCount < world.prey.objects.length, true);
  // A gone body is nowhere: not eaten again, not in queries.
  const n = world.prey.query(body.position.x, body.position.z, 1e6, 1);
  for (let k = 0; k < n; k++) assert.notEqual(world.prey.found[k], 0);

  // The hole shrinks back to a pea: the body respawns, out of its sight.
  setMass(hole, hole.startMass);
  run(world, ARENA.respawnRetry + 0.5, () => holdComets(world));
  assert.equal(body.state, 'alive');
  assert.ok(distance(body, hole) > ARENA.holeClearViews * viewDistance(hole.radius));
});

test('the gas wall: a hole driving outward is pushed back inside the edge at any size; nothing pushes in the middle', () => {
  for (const radius of [0.5, 5, 60]) {
    const world = calmWorld(44);
    const hole = world.focus;
    hole.hunger.enabled = false;
    world.dangers.enabled = false;
    setMass(hole, holeMassForRadius(radius));
    // In the middle: no push.
    run(world, 0.1, () => holdComets(world));
    assert.equal(hole.pull.x, 0);
    assert.equal(hole.pull.z, 0);

    // Start just inside the soft edge and drive straight out at full speed for a good while.
    const width = edgeWidth(hole.radius);
    hole.position.x = ARENA.radius - width * 1.05;
    hole.position.z = 0;
    hole.velocity.x = topSpeed(hole.radius);
    hole.input.x = 1;
    let deepest = 0;
    let pushed = false;
    run(world, 6, () => {
      holdComets(world);
      deepest = Math.max(deepest, Math.hypot(hole.position.x, hole.position.z));
      if (hole.pull.x < 0) pushed = true;
    });
    assert.ok(pushed);
    // It may lean into the gas a little but never gets more than the hard limit past the edge.
    assert.ok(deepest <= ARENA.radius + ARENA.edgeHardLimit * width + 1e-6, `radius ${radius}: ${deepest}`);
    // Letting go: the wall pushes it back inside.
    hole.input.x = 0;
    run(world, 4, () => holdComets(world));
    assert.ok(Math.hypot(hole.position.x, hole.position.z) < ARENA.radius, `radius ${radius}`);
    assert.ok(hole.velocity.x <= 1e-9);
  }
});
