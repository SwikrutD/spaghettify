import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../World.ts';
import { digest } from './helpers.ts';

/**
 * A minute of scripted play: the local hole sweeps in a slow figure of eight (so it eats, gets pulled and
 * bumps into things), a second hole circles, and the run restarts halfway. Returns the state digest every
 * second and every event.
 */
function play(seed: number): { digests: string[]; events: string[] } {
  const world = new World({ seed });
  const other = world.addHole(6, 0);
  const digests: string[] = [];
  const events: string[] = [];
  const steps = 60 / world.dt;
  for (let i = 0; i < steps; i++) {
    const t = i * world.dt;
    world.focus.input.x = Math.sin(t * 0.7);
    world.focus.input.z = Math.sin(t * 1.4) * 0.8;
    other.input.x = Math.cos(t);
    other.input.z = Math.sin(t);
    if (i === steps / 2) world.reset();
    world.step();
    for (const e of world.events) events.push(JSON.stringify(e));
    world.clearEvents();
    if (i % 60 === 0) digests.push(digest(world));
  }
  return { digests, events };
}

test('the same seed and the same inputs give the same world, step for step', () => {
  const a = play(1234);
  const b = play(1234);
  assert.equal(a.digests.length, b.digests.length);
  for (let i = 0; i < a.digests.length; i++) assert.equal(a.digests[i], b.digests[i], `worlds differ after ${i} s`);
  assert.deepEqual(a.events, b.events);
  // The script really exercises the rules: meals, hits and (in the first half) a second hole.
  assert.ok(a.events.some((e) => e.includes('"type":"ate"')));
  assert.ok(a.events.some((e) => e.includes('"type":"bumped"')));
});

test('a different seed gives a different world', () => {
  const a = play(1234);
  const b = play(4321);
  assert.notEqual(a.digests[1], b.digests[1]);
  assert.notEqual(a.digests.at(-1), b.digests.at(-1));
});

test('worlds are independent: stepping one never changes another', () => {
  const a = new World({ seed: 9 });
  const b = new World({ seed: 9 });
  for (let i = 0; i < 300; i++) a.step();
  const c = new World({ seed: 9 });
  for (let i = 0; i < 300; i++) {
    b.step();
    c.step();
  }
  assert.equal(digest(a), digest(b));
  assert.equal(digest(b), digest(c));
});

test('an arena with bots is deterministic too: the same seed gives the same hole fights, step for step', () => {
  const run = (seed: number): { digests: string[]; eaten: number } => {
    const world = new World({ seed, bots: 8 });
    const digests: string[] = [];
    let eaten = 0;
    const steps = 90 / world.dt;
    for (let i = 0; i < steps; i++) {
      world.step();
      for (const e of world.events) if (e.type === 'holeEaten') eaten++;
      world.clearEvents();
      if (i % 120 === 0) digests.push(digest(world));
    }
    return { digests, eaten };
  };
  const a = run(77);
  const b = run(77);
  assert.deepEqual(a.digests, b.digests);
  assert.equal(a.eaten, b.eaten);
  assert.notDeepEqual(a.digests, run(78).digests);
});
