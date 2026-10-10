import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOTS, HOLES } from '../../config/index.ts';
import { holeMassForRadius, viewDistance, type Hole } from '../Hole.ts';
import { World } from '../World.ts';
import { digest, distance, holdComets, run, setMass, step } from './helpers.ts';

/** A server room's world: no hole of its own, bots up to `bots`, plus `players` holes joined the way a room does it. */
function room(seed: number, bots: number, players: number): { world: World; humans: Hole[] } {
  const world = new World({ seed, bots, local: false });
  const humans: Hole[] = [];
  for (let i = 0; i < players; i++) {
    const hole = world.addHole();
    hole.name = `Player ${i + 1}`;
    world.respawn(hole);
    humans.push(hole);
  }
  world.botTarget = Math.max(0, bots - players);
  return { world, humans };
}

const botCount = (world: World) => world.holes.filter((h) => h.bot).length;

test('a server world has no hole of its own: only the bots, then the holes that join', () => {
  const world = new World({ seed: 201, bots: 4, local: false });
  assert.equal(world.holes.length, 4);
  assert.ok(world.holes.every((h) => h.bot));
  assert.ok(!world.holes.includes(world.focus));
  run(world, 2, () => holdComets(world));
  assert.ok(!world.holes.includes(world.focus));
  const hole = world.addHole();
  world.respawn(hole);
  assert.equal(world.holes.length, 5);
  assert.equal(hole.phase, 'playing');
  assert.ok(hole.protection > 0);
  // It spawns out of every bot's sight, wherever it was added (it does not keep away from its own first place).
  for (const bot of world.holes.filter((h) => h.bot)) assert.ok(distance(bot, hole) > viewDistance(bot.radius));
});

test('bots step aside for players: one whose life ends leaves at once instead of coming back', () => {
  const { world, humans } = room(202, 5, 1);
  assert.equal(botCount(world), 5);
  assert.equal(world.botTarget, 4);
  // The player's hole, much bigger, swallows a bot.
  const hunter = humans[0];
  hunter.hunger.enabled = false;
  setMass(hunter, holeMassForRadius(25));
  hunter.protection = 0;
  const victim = world.holes.find((h) => h.bot)!;
  victim.protection = 0;
  victim.position.x = hunter.position.x + 1;
  victim.position.z = hunter.position.z;
  const events = run(world, HOLES.infallTime + 0.2, () => holdComets(world));
  assert.ok(events.some((e) => e.type === 'holeEaten' && e.victim === victim.id));
  assert.ok(events.some((e) => e.type === 'died' && e.hole === victim.id));
  // Gone from the arena at once, not waiting to respawn; the rest stay.
  assert.ok(!world.holes.includes(victim));
  assert.equal(botCount(world), 4);
  run(world, BOTS.respawnDelay[1] + 1, () => holdComets(world));
  assert.equal(botCount(world), 4);
});

test('while there are still too many, the smallest bot no player can see leaves every BOTS.retireAfter seconds', () => {
  const { world, humans } = room(203, 6, 2);
  for (const h of world.holes) h.hunger.enabled = false;
  // Keep the bots alive and at their sizes (nothing to eat or bump into): freeze them apart.
  world.field.enabled = false;
  world.dangers.enabled = false;
  const bots = world.holes.filter((h) => h.bot);
  bots.forEach((b, i) => {
    b.position.x = -900 + i * 300;
    b.position.z = 600;
    setMass(b, holeMassForRadius(1 + i));
  });
  // A player sits right next to the smallest bot: that one is watched and stays.
  const watched = bots[0];
  humans[0].position.x = watched.position.x + 3;
  humans[0].position.z = watched.position.z;
  humans[1].position.x = 0;
  humans[1].position.z = -900;
  const freeze = () => {
    holdComets(world);
    bots.forEach((b, i) => {
      if (!world.holes.includes(b)) return;
      b.position.x = -900 + i * 300;
      b.position.z = 600;
      b.velocity.x = b.velocity.z = 0;
    });
    humans[0].position.x = watched.position.x + 3;
    humans[0].position.z = watched.position.z;
    humans[1].position.x = 0;
    humans[1].position.z = -900;
  };
  assert.equal(world.botTarget, 4);
  // Not before the delay.
  run(world, BOTS.retireAfter - 0.5, freeze);
  assert.equal(botCount(world), 6);
  // Then the smallest one nobody watches (bots[1]), and after another delay the next smallest (bots[2]).
  run(world, 1, freeze);
  assert.equal(botCount(world), 5);
  assert.ok(!world.holes.includes(bots[1]));
  assert.ok(world.holes.includes(watched));
  run(world, BOTS.retireAfter, freeze);
  assert.equal(botCount(world), 4);
  assert.ok(!world.holes.includes(bots[2]));
  // At the target nothing else leaves.
  run(world, BOTS.retireAfter * 2, freeze);
  assert.equal(botCount(world), 4);
  assert.ok(world.holes.includes(watched));
});

test('a player leaving brings a bot back at once (protected, small, out of sight)', () => {
  const { world, humans } = room(204, 4, 2);
  run(world, BOTS.retireAfter * 3, () => holdComets(world));
  assert.equal(botCount(world), 2);
  const leaving = humans[1];
  world.removeHole(leaving);
  world.botTarget++;
  assert.ok(!world.holes.includes(leaving));
  step(world);
  assert.equal(botCount(world), 3);
  const fresh = world.holes.filter((h) => h.bot).sort((a, b) => b.id - a.id)[0];
  assert.ok(fresh.id > leaving.id, 'a new bot hole');
  assert.ok(fresh.protection > 0);
  assert.ok(fresh.radius <= BOTS.respawnRadius[1] * 1.01);
  assert.ok(distance(fresh, humans[0]) > viewDistance(humans[0].radius));
});

test('a room world with players joining, leaving and bots stepping aside stays deterministic', () => {
  const play = () => {
    const { world, humans } = room(205, 6, 3);
    for (let t = 0; t < 40 * 60; t++) {
      if (t % 30 === 0) holdComets(world);
      humans.forEach((h, i) => {
        const a = t * 0.01 + i * 2;
        h.input.x = Math.cos(a);
        h.input.z = Math.sin(a);
      });
      if (t === 20 * 60) {
        world.removeHole(humans[2]);
        world.botTarget++;
      }
      world.step();
      world.clearEvents();
    }
    return digest(world);
  };
  assert.equal(play(), play());
});
