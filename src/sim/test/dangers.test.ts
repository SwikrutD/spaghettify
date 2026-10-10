import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DANGER, DEBRIS, PREY } from '../../config/index.ts';
import type { BumpedEvent, ShedEvent } from '../events.ts';
import { viewDistance } from '../Hole.ts';
import { calmWorld, distance, holdComets, placeBody, run, setMass, step } from './helpers.ts';

test('touching a big body knocks the hole back, sheds a fifth of its mass (not score) as hot debris, then it is invulnerable', () => {
  const world = calmWorld(11);
  const hole = world.focus;
  setMass(hole, hole.startMass * 9);
  const before = { mass: hole.mass, radius: hole.radius, eatenMass: hole.eatenMass };
  // Touching on the right: one hit on the next step.
  const body = placeBody(world, 0, hole.radius * 4, hole.position.x + hole.radius * 4, hole.position.z);

  const events = step(world);
  const bumped = events.filter((e): e is BumpedEvent => e.type === 'bumped');
  const shed = events.filter((e): e is ShedEvent => e.type === 'shed');
  assert.equal(bumped.length, 1);
  assert.equal(bumped[0].by, 'body');
  assert.ok(bumped[0].nx < -0.99);
  assert.equal(shed.length, 1);
  assert.ok(Math.abs(shed[0].mass - before.mass * DANGER.shedFraction) < 1e-12);
  assert.equal(hole.hits, 1);
  assert.ok(Math.abs(hole.mass - before.mass * (1 - DANGER.shedFraction)) < 1e-12);
  assert.ok(Math.abs(hole.shedMass - shed[0].mass) < 1e-12);
  assert.equal(hole.eatenMass, before.eatenMass);
  // Pushed out and moving away, stunned and invulnerable for a while.
  assert.ok(distance(hole, body) >= hole.radius + body.radius);
  assert.ok(hole.velocity.x < 0);
  assert.ok(hole.stun > 0);
  assert.ok(hole.invulnerable > DANGER.invulnerableTime - 0.05);
  // A hit alone never ends a life: what is left is well above the evaporation mass.
  assert.ok(hole.mass > hole.hunger.floorMass);

  // The shed mass flies off as hot, edible fragments, away from the body.
  const frags = world.debris.objects.filter((f) => f.active);
  assert.equal(frags.length, DEBRIS.perHit);
  assert.ok(Math.abs(world.debris.liveMass - shed[0].mass * DEBRIS.massFraction) < 1e-12);
  for (const f of frags) {
    assert.equal(f.ownerId, hole.id);
    assert.ok(f.velocity.x < 0);
    assert.ok(f.heat > 0.9);
    assert.ok(f.radius < hole.radiusForMass() * PREY.edibleRatio);
  }

  // The radius drops fast: all the way down within half a second.
  run(world, 0.5, () => holdComets(world));
  assert.ok(hole.radius < before.radius * 0.92);
  assert.ok(Math.abs(hole.radius - hole.radiusForMass()) < hole.radiusForMass() * 0.03);
  for (const f of frags) assert.ok(f.heat < 0.9);
});

test('an invulnerable hole shoved into a body is pushed out but loses nothing and throws nothing', () => {
  const world = calmWorld(12);
  const hole = world.focus;
  setMass(hole, hole.startMass * 9);
  const body = placeBody(world, 0, hole.radius * 4, hole.position.x + hole.radius * 4, hole.position.z);
  step(world);
  world.debris.reset();
  assert.ok(hole.invulnerable > 0);
  const mass = hole.mass;
  hole.position.x = body.position.x - body.radius * 0.5;
  hole.position.z = body.position.z;
  const events = run(world, world.dt * 2);
  assert.equal(events.filter((e) => e.type === 'bumped').length, 0);
  assert.equal(hole.hits, 1);
  assert.equal(hole.mass, mass);
  assert.equal(world.debris.emitted, 0);
  assert.ok(distance(hole, body) >= hole.radius + body.radius);
});

test('repeated hits each shed again once the invulnerability wears off, but never below the start mass', () => {
  const world = calmWorld(13);
  const hole = world.focus;
  hole.hunger.enabled = false;
  setMass(hole, hole.startMass * 9);
  /** Wait out the invulnerability, hit the hole once, then clear the body, the debris and the knockback away. */
  const hitOnce = () => {
    run(world, DANGER.invulnerableTime + 0.1, () => holdComets(world));
    const mass = hole.mass;
    const body = placeBody(world, 0, hole.radius * 4, hole.position.x + hole.radius * 4, hole.position.z);
    step(world);
    const lost = mass - hole.mass;
    body.position.x += 1e6;
    world.debris.reset();
    hole.stun = 0;
    hole.velocity.x = hole.velocity.z = 0;
    return { mass, lost };
  };
  for (let i = 0; i < 2; i++) {
    const { mass, lost } = hitOnce();
    assert.ok(Math.abs(lost - mass * DANGER.shedFraction) < 1e-12);
  }
  assert.equal(hole.hits, 2);

  // Just over the start mass: only the difference goes.
  setMass(hole, hole.startMass * 1.1);
  const { lost } = hitOnce();
  assert.ok(Math.abs(hole.mass - hole.startMass) < 1e-12);
  assert.ok(Math.abs(lost - hole.startMass * 0.1) < 1e-12);
  assert.equal(hole.hits, 3);
  assert.equal(hole.phase, 'playing');
});

test('a big body pulls a hole with no input toward it; holding away escapes', () => {
  const world = calmWorld(14);
  const hole = world.focus;
  placeBody(world, 0, hole.radius * 4, hole.position.x + hole.radius * 7, hole.position.z);
  run(world, 1, () => holdComets(world));
  assert.ok(hole.pull.x > 0);
  assert.ok(Math.abs(hole.pull.z) < hole.pull.x * 0.01);
  assert.ok(hole.position.x > hole.radius * 0.3);
  assert.equal(hole.hits, 0);

  const x = hole.position.x;
  hole.input.x = -1;
  run(world, 1, () => holdComets(world));
  assert.ok(hole.position.x < x - hole.radius);
});

test('comets: one aimed at a hole that cannot eat it knocks the hole along its travel; a small one is eaten', () => {
  const world = calmWorld(15);
  const hole = world.focus;
  const view = viewDistance(hole.radius);
  holdComets(world);
  const comet = world.comets.launch(hole.position.x - view * 0.5, hole.position.z, view, 0, hole.radius * 2);
  assert.ok(comet);
  const events = run(world, 1);
  const bumped = events.filter((e): e is BumpedEvent => e.type === 'bumped');
  assert.equal(bumped.length, 1);
  assert.equal(bumped[0].by, 'comet');
  assert.ok(hole.velocity.x > 0);

  holdComets(world);
  world.debris.reset();
  hole.stun = 0;
  hole.velocity.x = hole.velocity.z = 0;
  const small = world.comets.launch(hole.position.x, hole.position.z - hole.radius * 4, 0, hole.radius * 6, hole.radius * 0.5);
  assert.ok(small);
  const eaten = run(world, 1).filter((e) => e.type === 'ate');
  assert.equal(eaten.length, 1);
  assert.equal(small.state, 'eating');
  assert.equal(hole.biggestEaten?.name, 'comet');
});
