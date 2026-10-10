import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARENA, BOTS, DANGER, DEBRIS, HOLES } from '../../config/index.ts';
import type { AteEvent, BumpedEvent, DiedEvent, HoleEatenEvent, ShedEvent } from '../events.ts';
import { holeMassForRadius, responsiveness, topSpeed, viewDistance, type Hole } from '../Hole.ts';
import { World } from '../World.ts';
import { calmWorld, distance, holdComets, placeBody, run, setMass, step } from './helpers.ts';

/** A calm world with two still holes of the given radii, `gap` apart on the x axis (a at the origin), no decay. */
function twoHoles(seed: number, ra: number, rb: number, gap: number): { world: World; a: Hole; b: Hole } {
  const world = calmWorld(seed);
  const a = world.focus;
  const b = world.addHole(gap, 0);
  a.name = 'Alpha';
  b.name = 'Beta';
  for (const h of [a, b]) h.hunger.enabled = false;
  setMass(a, holeMassForRadius(ra));
  setMass(b, holeMassForRadius(rb));
  a.capture();
  b.capture();
  return { world, a, b };
}

test('a hole clearly bigger swallows a smaller one it covers: most of the mass transfers on the hole curve and the victim spaghettifies into it', () => {
  const { world, a, b } = twoHoles(101, 5, 3.5, 2);
  const victimMass = b.mass;
  const massBefore = a.mass;
  const events = step(world);

  const eaten = events.filter((e): e is HoleEatenEvent => e.type === 'holeEaten');
  assert.equal(eaten.length, 1);
  assert.equal(eaten[0].eater, a.id);
  assert.equal(eaten[0].victim, b.id);
  assert.equal(eaten[0].eaterName, 'Alpha');
  assert.equal(eaten[0].victimName, 'Beta');
  // Mass is on the hole curve: the eater gains the transfer fraction of the victim's mass, whatever the radii.
  assert.ok(Math.abs(a.mass - (massBefore + victimMass * HOLES.massTransfer)) < 1e-9);
  assert.ok(Math.abs(eaten[0].gained - victimMass * HOLES.massTransfer) < 1e-9);
  const radiusSquaredRule = 5 * 5 + 3.5 * 3.5;
  assert.ok(a.mass > radiusSquaredRule * 0.9, 'a hole of radius 3.5 is far more mass than 3.5 squared');
  // The eater's own meal bookkeeping and the event the feedback listens for.
  const ate = events.filter((e): e is AteEvent => e.type === 'ate' && e.hole === a.id);
  assert.equal(ate.length, 1);
  assert.deepEqual(ate[0].what, { name: 'Beta', radius: b.radius, hole: true });
  assert.equal(a.holesEaten, 1);
  assert.equal(a.eatenCount, 1);
  assert.equal(a.biggestEaten?.name, 'Beta');
  // The victim is being swallowed: out of play, no longer steering or eating.
  assert.equal(b.phase, 'eaten');
  assert.equal(b.eatenBy, a.id);
  assert.equal(b.eatenByName, 'Alpha');
  assert.equal(b.canEat, false);
  assert.ok(b.absent);
  assert.equal(events.filter((e) => e.type === 'died').length, 0);

  // After the infall its life is over, with one died event naming the eater.
  const later = run(world, HOLES.infallTime + 0.2, () => holdComets(world));
  assert.equal(b.phase, 'over');
  const died = later.filter((e): e is DiedEvent => e.type === 'died');
  assert.equal(died.length, 1);
  assert.deepEqual(died[0], { type: 'died', hole: b.id, cause: 'eaten', by: a.id, byName: 'Alpha' });
  assert.equal(b.eatProgress, 1);
  // Its place relative to the eater was fixed at the moment it was swallowed.
  assert.ok(Math.abs(b.eatOffset.x - 2) < 1e-6);
});

test('the bigger hole has to cover the centre, and the ratio has to clear HOLES.eatRatio', () => {
  // Overlapping but the centre is not covered: nothing happens yet.
  let { world, a, b } = twoHoles(102, 5, 3.5, 5 * HOLES.coverFraction + 0.3);
  step(world);
  assert.equal(b.phase, 'playing');
  assert.equal(a.holesEaten, 0);
  // Drifting in until the centre is covered: swallowed.
  b.position.x = 5 * HOLES.coverFraction - 0.1;
  step(world);
  assert.equal(b.phase, 'eaten');

  // Radii just under the ratio never swallow, however deep: they bump instead.
  ({ world, a, b } = twoHoles(103, 5, 5 / (HOLES.eatRatio - 0.02), 1));
  step(world);
  assert.equal(b.phase, 'playing');
  assert.equal(a.phase, 'playing');
  assert.equal(a.holesEaten + b.holesEaten, 0);
  // Just over the ratio swallows.
  ({ world, b } = twoHoles(104, 5, 5 / (HOLES.eatRatio + 0.02), 1));
  step(world);
  assert.equal(b.phase, 'eaten');
});

test('holes of near size bump: pushed apart, knocked back, both shed a share of their mass as debris, neither eats', () => {
  const { world, a, b } = twoHoles(105, 4, 3.8, 5);
  const massA = a.mass;
  const massB = b.mass;
  const events = step(world);
  const bumped = events.filter((e): e is BumpedEvent => e.type === 'bumped');
  const shed = events.filter((e): e is ShedEvent => e.type === 'shed');
  assert.equal(bumped.length, 2);
  assert.ok(bumped.every((e) => e.by === 'hole'));
  assert.equal(shed.length, 2);
  assert.ok(Math.abs(a.mass - massA * (1 - DANGER.shedFraction)) < 1e-9);
  assert.ok(Math.abs(b.mass - massB * (1 - DANGER.shedFraction)) < 1e-9);
  assert.equal(a.hits, 1);
  assert.equal(b.hits, 1);
  assert.ok(a.velocity.x < 0 && b.velocity.x > 0, 'knocked apart');
  assert.ok(a.stun > 0 && b.stun > 0);
  assert.ok(a.invulnerable > 0 && b.invulnerable > 0);
  assert.ok(distance(a, b) >= (a.radius + b.radius) * HOLES.bumpOverlap - 1e-9);
  assert.equal(a.holesEaten + b.holesEaten, 0);
  // Two sprays of debris, each owned by the hole that shed it.
  const frags = world.debris.objects.filter((f) => f.active);
  assert.equal(frags.length, DEBRIS.perHit * 2);
  assert.equal(frags.filter((f) => f.ownerId === a.id).length, DEBRIS.perHit);
  assert.equal(frags.filter((f) => f.ownerId === b.id).length, DEBRIS.perHit);

  // Pushed out of contact and invulnerable: running into each other again straight away does nothing more.
  a.position.x = 0;
  b.position.x = 3;
  const more = step(world);
  assert.equal(more.filter((e) => e.type === 'bumped').length, 0);
});

test('a hole in spawn protection can neither be eaten nor eat; when it ends the rules apply', () => {
  const { world, a, b } = twoHoles(106, 5, 3, 1);
  b.protection = 1;
  run(world, 0.5, () => holdComets(world));
  assert.equal(b.phase, 'playing');
  assert.equal(a.holesEaten, 0);
  // The other way round: a protected big hole does not swallow either.
  b.protection = 0;
  a.protection = 1;
  step(world);
  assert.equal(b.phase, 'playing');
  a.protection = 0;
  step(world);
  assert.equal(b.phase, 'eaten');
});

test('a hole being swallowed stays put relative to its eater, ignores input and eats nothing', () => {
  const { world, a, b } = twoHoles(107, 5, 3, 2);
  const food = placeBody(world, 0, 0.2, 40, 40);
  b.input.x = 1;
  step(world);
  assert.equal(b.phase, 'eaten');
  b.input.x = 1;
  a.velocity.x = 3;
  const start = { x: b.position.x, z: b.position.z };
  run(world, 0.4, () => holdComets(world));
  assert.equal(b.velocity.x, 0);
  assert.equal(b.position.x, start.x);
  assert.equal(food.state, 'alive');
  assert.ok(b.eatProgress > 0.2 && b.eatProgress < 1);
});

test('bots fill the arena to the target count with unique names, bots are marked, and the player is not one', () => {
  const world = new World({ seed: 111, bots: BOTS.count });
  const bots = world.holes.filter((h) => h.bot);
  assert.equal(bots.length, BOTS.count);
  assert.equal(world.holes.length, BOTS.count + 1);
  assert.equal(world.focus.bot, null);
  const names = new Set(bots.map((h) => h.name));
  assert.equal(names.size, BOTS.count);
  for (const bot of bots) {
    assert.ok(bot.name.length > 2);
    assert.ok(bot.radius >= BOTS.initialRadius[0] * 0.999 && bot.radius <= BOTS.initialRadius[1] * 1.001);
    assert.equal(bot.protection, 0);
    assert.ok(Math.hypot(bot.position.x, bot.position.z) < ARENA.radius);
  }
  // A mix of sizes, spread over the arena, and none starts in sight of another hole.
  assert.ok(Math.max(...bots.map((h) => h.radius)) > 3 * Math.min(...bots.map((h) => h.radius)));
  for (const h of world.holes) {
    for (const o of world.holes) if (o !== h && o.radius <= h.radius) assert.ok(distance(h, o) > viewDistance(h.radius) * 0.9, `${h.name} sees ${o.name}`);
  }
  // Nothing at the start pulls the player.
  world.step();
  assert.equal(world.focus.pull.x, 0);
});

test('a bot is steered only through its input vector, within its throttle, and it moves', () => {
  const world = new World({ seed: 112, bots: 4 });
  for (const h of world.holes) h.hunger.enabled = false;
  const bot = world.holes.find((h) => h.bot)!;
  const start = { x: bot.position.x, z: bot.position.z };
  let steered = false;
  run(world, 6, () => {
    holdComets(world);
    const len = Math.hypot(bot.input.x, bot.input.z);
    assert.ok(len <= 1 + 1e-9 && len <= bot.bot!.throttle + 1e-9);
    if (len > 0.5) steered = true;
  });
  assert.ok(steered);
  assert.ok(Math.hypot(bot.position.x - start.x, bot.position.z - start.z) > 2);
});

/** A calm world with a bot of radius `r` at the origin and nothing else in sight. */
function lonelyBot(seed: number, r: number): { world: World; bot: Hole } {
  const world = calmWorld(seed);
  world.botTarget = 0;
  world.focus.reset(900, 900);
  world.focus.hunger.enabled = false;
  const bot = world.addBot([r, r], false);
  bot.reset(0, 0);
  setMass(bot, holeMassForRadius(r));
  bot.hunger.enabled = false;
  bot.bot!.wobble = 0;
  bot.bot!.throttle = 1;
  bot.bot!.reaction = 0.1;
  return { world, bot };
}

test('a bot flees a bigger hole, chases a smaller one and steers for the meal it can reach', () => {
  // Flee: the big hole is to the right, so the bot steers left.
  let { world, bot } = lonelyBot(121, 3);
  const big = world.addHole(15, 0);
  setMass(big, holeMassForRadius(6));
  bot.bot!.caution = 1;
  step(world);
  run(world, 0.3, () => holdComets(world));
  assert.equal(bot.bot!.mode, 'flee');
  assert.equal(bot.bot!.targetId, big.id);
  assert.ok(bot.input.x < -0.5, `flee input ${bot.input.x}`);

  // Chase: a hole well under it to the upper left, nothing else to eat nearby.
  ({ world, bot } = lonelyBot(122, 6));
  const small = world.addHole(-20, 10);
  setMass(small, holeMassForRadius(3));
  small.hunger.enabled = false;
  bot.bot!.aggression = 1;
  run(world, 0.3, () => holdComets(world));
  assert.equal(bot.bot!.mode, 'chase');
  assert.equal(bot.bot!.targetId, small.id);
  assert.ok(bot.input.x < -0.5 && bot.input.z > 0.1, `chase input ${bot.input.x}, ${bot.input.z}`);

  // Feed: a lone edible rock above, nothing else.
  ({ world, bot } = lonelyBot(123, 3));
  placeBody(world, 0, 1.2, 0, -25);
  run(world, 0.3, () => holdComets(world));
  assert.equal(bot.bot!.mode, 'feed');
  assert.ok(bot.input.z < -0.5, `feed input ${bot.input.z}`);
});

test('a bot steers around a body it cannot eat instead of into it', () => {
  const { world, bot } = lonelyBot(124, 1);
  // A rock it cannot eat sits just ahead of an edible one.
  placeBody(world, 1, 3, 0, -6);
  placeBody(world, 0, 0.5, 6, -15);
  world.dangers.enabled = false;
  const touched = { hits: 0 };
  world.dangers.enabled = true;
  run(world, 6, () => {
    holdComets(world);
    bot.hunger.idle = 0;
  });
  touched.hits = bot.hits;
  assert.equal(touched.hits, 0, 'the bot ran into the body');
  assert.ok(bot.eatenCount >= 1, 'and it still got to the meal');
});

test('a bot whose life ends comes back after a delay as a new character at a clear spawn point', () => {
  const world = new World({ seed: 131, bots: 3 });
  const victim = world.holes.find((h) => h.bot)!;
  const gen = victim.gen;
  const hunter = world.addHole(0, 0);
  hunter.name = 'Hunter';
  hunter.hunger.enabled = false;
  victim.hunger.enabled = false;
  // Put them together and make the hunter much bigger.
  setMass(hunter, holeMassForRadius(30));
  victim.position.x = hunter.position.x + 1;
  victim.position.z = hunter.position.z;
  hunter.protection = 0;
  victim.protection = 0;
  const events = run(world, HOLES.infallTime + 0.3, () => holdComets(world));
  assert.ok(events.some((e) => e.type === 'holeEaten' && e.victim === victim.id));
  assert.equal(victim.phase, 'over');
  // Back after its delay: a new life of the same hole.
  for (let i = 0; i < 60 * (BOTS.respawnDelay[1] + 0.5) && (victim.phase as string) !== 'playing'; i++) step(world);
  assert.equal(victim.phase, 'playing');
  assert.ok(victim.gen > gen);
  assert.ok(victim.protection > 0 && victim.protection <= HOLES.spawnProtection);
  assert.ok(victim.radius <= BOTS.respawnRadius[1] * 1.01);
  assert.ok(victim.bot);
  assert.ok(victim.name.length > 2);
  assert.equal(world.holes.filter((h) => h.bot).length, 3);
});

test('respawning a hole in a running arena picks a place out of every hole\'s sight with nothing it cannot eat in pulling reach and food around', () => {
  const world = new World({ seed: 141, bots: BOTS.count });
  for (let round = 0; round < 6; round++) {
    const hole = world.focus;
    world.respawn(hole);
    assert.equal(hole.phase, 'playing');
    assert.equal(hole.radius, hole.radiusForMass());
    assert.ok(hole.protection > 0);
    world.step();
    // Whatever pulls the new hole is faint (the giants' reach covers much of the arena), and nothing touches it.
    const authority = responsiveness(hole.radius) * topSpeed(hole.radius);
    assert.ok(Math.hypot(hole.pull.x, hole.pull.z) < 0.04 * authority, `pull ${Math.hypot(hole.pull.x, hole.pull.z) / authority}`);
    assert.equal(hole.hits, 0);
    for (const other of world.holes) {
      if (other === hole) continue;
      const clear = ARENA.holeClearViews * viewDistance(other.radius);
      // Out of sight of every hole it can be (with a very big hole in the arena there may be no such place).
      if (clear + viewDistance(hole.radius) < ARENA.radius * 0.6) assert.ok(distance(other, hole) > clear, `${other.name} sees the spawn`);
    }
    // Some food within its sight.
    let food = 0;
    world.field.forEach(0, hole.position.x, hole.position.z, viewDistance(hole.radius), 0, () => void food++);
    assert.ok(food >= 4, `only ${food} grains in sight`);
    // Another life from somewhere else.
    run(world, 2, () => holdComets(world));
  }
});

test('Hole.reset keeps the unlived parts clean: a respawned hole is a fresh life', () => {
  const { world, a, b } = twoHoles(151, 5, 3, 1);
  step(world);
  run(world, HOLES.infallTime + 0.3, () => holdComets(world));
  assert.equal(b.phase, 'over');
  const gen = b.gen;
  world.respawn(b);
  assert.equal(b.phase, 'playing');
  assert.equal(b.eatenBy, -1);
  assert.equal(b.eatenByName, '');
  assert.equal(b.eatProgress, 0);
  assert.equal(b.holesEaten, 0);
  assert.equal(b.gen, gen + 1);
  assert.equal(b.mass, b.startMass);
  assert.ok(b.protection > 0);
  assert.equal(a.holesEaten, 1);
});

test('World.reset (quit to title) starts the whole arena over: a fresh player at the middle and the bots made anew, up to the target', () => {
  const world = new World({ seed: 161, bots: 5 });
  const names = world.holes.filter((h) => h.bot).map((h) => h.name);
  run(world, 3, () => holdComets(world));
  world.focus.mass = 50;
  world.reset();
  assert.equal(world.holes.length, 6);
  assert.equal(world.holes.filter((h) => h.bot).length, 5);
  assert.equal(world.focus.mass, world.focus.startMass);
  assert.equal(world.focus.position.x, 0);
  assert.equal(world.tick, 0);
  assert.notDeepEqual(world.holes.filter((h) => h.bot).map((h) => h.name), names);
});
