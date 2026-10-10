import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOTS, HOLES, NET, SIM } from '../../src/config/index.ts';
import type { RunSubmission } from '../../src/leaderboard/rules.ts';
import { holeMassForRadius, type Hole } from '../../src/sim/Hole.ts';
import { Player } from '../src/arena/Player.ts';
import { Room } from '../src/arena/Room.ts';
import { Rooms, type ArenaOptions } from '../src/arena/Rooms.ts';
import { TestLink } from './helpers.ts';

/** Rooms on a hand-driven clock, recording what they post to the leaderboard. */
function arena(options: Partial<ArenaOptions> = {}): { rooms: Rooms; posted: RunSubmission[]; clock: { now: number } } {
  const posted: RunSubmission[] = [];
  const clock = { now: 0 };
  let seed = 400;
  const rooms = new Rooms({ seed: () => seed++, now: () => clock.now, ...options }, (run) => {
    posted.push(run);
    return { rank: posted.length, total: posted.length, best: run.score, personalBest: true };
  });
  return { rooms, posted, clock };
}

function connect(rooms: Rooms, name?: string): { player: Player; link: TestLink } {
  const link = new TestLink();
  const player = new Player(link);
  assert.ok(rooms.join(player, name, 1.4), 'joined');
  return { player, link };
}

/** Run a room for `seconds` of steps (snapshots on schedule), calling `each` before every step. */
function run(room: Room, seconds: number, each?: () => void): void {
  for (let i = Math.round(seconds * SIM.tickRate); i > 0; i--) {
    each?.();
    room.step();
    if (room.world.tick % 3 === 0) room.broadcast();
  }
}

const bots = (room: Room) => room.world.holes.filter((h) => h.bot);

test('join: a hole in the room under the cleaned nickname (or a generated name if refused or empty), and a bot steps aside', () => {
  const { rooms } = arena();
  const a = connect(rooms, '  Event<b>  Horizon ');
  const room = a.player.room!;
  const welcome = a.link.messages.length === 0 ? null : a.link.messages[0];
  assert.equal(welcome, null, 'the welcome is the socket layer\'s to send');
  assert.equal(rooms.rooms.length, 1);
  assert.equal(a.player.hole!.name, 'Eventb Horizon');
  assert.ok(a.player.named);
  assert.ok(room.world.holes.includes(a.player.hole!));
  assert.ok(a.player.hole!.protection > 0, 'protected at the start');
  assert.equal(room.world.botTarget, NET.rooms.population - 1);

  const link = new TestLink();
  const b = new Player(link);
  const w = rooms.join(b, 'shithead', undefined)!;
  assert.equal(w.t, 'welcome');
  assert.equal(w.refused, true);
  assert.equal(w.named, false);
  assert.notEqual(w.name, 'shithead');
  assert.ok(w.name.length > 2);
  assert.equal(w.hole, b.hole!.id);
  assert.equal(w.seed, room.world.seed);
  assert.equal(w.room, room.id);
  // No nickname: a generated one, not refused.
  const c = new Player(new TestLink());
  const wc = rooms.join(c, '', undefined)!;
  assert.equal(wc.refused, false);
  assert.equal(wc.named, false);
  assert.equal(room.world.botTarget, NET.rooms.population - 3);
  // Joining twice is refused.
  assert.equal(rooms.join(c, 'again', undefined), null);
});

test('quick play joins the fullest room with space, opens a new one when all are full, and says full past maxRooms', () => {
  const { rooms } = arena({ maxPlayers: 3, maxRooms: 2 });
  const p = [0, 1, 2].map((i) => connect(rooms, `P${i}`));
  assert.equal(rooms.rooms.length, 1);
  assert.ok(p.every(({ player }) => player.room === rooms.rooms[0]));
  const q = connect(rooms, 'Q');
  assert.equal(rooms.rooms.length, 2);
  assert.equal(q.player.room, rooms.rooms[1]);
  // One leaves the first room: it is still the fullest with space (2 against 1).
  rooms.leave(p[0].player);
  assert.equal(p[0].player.room, null);
  const r = connect(rooms, 'R');
  assert.equal(r.player.room, rooms.rooms[0]);
  // Fill everything.
  connect(rooms, 'S');
  connect(rooms, 'T');
  assert.ok(rooms.rooms.every((room) => room.full));
  assert.equal(rooms.join(new Player(new TestLink()), 'U', undefined), null);
  assert.equal(rooms.players, 6);
});

test('leave: the hole leaves the arena, a life in progress is scored and posted as it stands, and a bot comes back', () => {
  const { rooms, posted } = arena();
  const a = connect(rooms, 'Alpha');
  const room = a.player.room!;
  const hole = a.player.hole!;
  hole.mass = holeMassForRadius(3);
  hole.peakMass = hole.mass;
  run(room, 0.5);
  const score = hole.score;
  assert.ok(score > 0);
  rooms.leave(a.player);
  assert.ok(!room.world.holes.includes(hole));
  assert.equal(room.world.botTarget, NET.rooms.population);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].nickname, 'Alpha');
  assert.equal(posted[0].score, score);
  run(room, 0.1);
  assert.equal(bots(room).length, NET.rooms.population);
  // Leaving again does nothing.
  rooms.leave(a.player);
  assert.equal(posted.length, 1);
});

test('bots step aside as players join and come back as they leave', () => {
  const { rooms } = arena({ population: 6 });
  const p = [0, 1, 2].map((i) => connect(rooms, `P${i}`));
  const room = p[0].player.room!;
  assert.equal(bots(room).length, 6);
  assert.equal(room.world.botTarget, 3);
  // Bots leave as their lives end or, out of every player's sight, a few seconds apart.
  run(room, BOTS.retireAfter * 3 + 1);
  assert.equal(bots(room).length, 3);
  assert.equal(room.world.holes.length, 6);
  rooms.leave(p[2].player);
  rooms.leave(p[1].player);
  run(room, 0.1);
  assert.equal(bots(room).length, 5);
  assert.equal(room.world.holes.length, 6);
});

test('a player eaten by a bot: the server scores the life and posts it (bots never), Play again respawns the hole in the running arena', () => {
  const { rooms, posted } = arena({ population: 4 });
  const a = connect(rooms, 'Alpha');
  const room = a.player.room!;
  const hole: Hole = a.player.hole!;
  hole.mass = hole.peakMass = holeMassForRadius(2);
  hole.radius = hole.radiusForMass();
  const gen = hole.gen;
  // A big bot right on top of the player once its protection is over.
  const bot = bots(room)[0];
  bot.hunger.enabled = false;
  bot.mass = holeMassForRadius(12);
  bot.radius = bot.radiusForMass();
  hole.protection = 0;
  bot.protection = 0;
  const pin = () => {
    if (hole.phase !== 'playing') return;
    bot.position.x = hole.position.x + 0.5;
    bot.position.z = hole.position.z;
  };
  run(room, HOLES.infallTime + 0.3, pin);
  assert.equal(hole.phase, 'over');
  assert.equal(hole.eatenBy, bot.id);
  // The snapshots told the client how it went, then the scored life came.
  const events = a.link.snapshots.flatMap((s) => s.events);
  assert.ok(events.some((e) => e.type === 'holeEaten' && e.victim === hole.id && e.eater === bot.id));
  assert.ok(events.some((e) => e.type === 'died' && e.hole === hole.id && e.cause === 'eaten'));
  assert.ok(a.link.snapshots.some((s) => s.you.phase === 'eaten' && s.you.eatenBy === bot.id));
  const [over] = a.link.of('over');
  assert.ok(over, 'over message');
  assert.equal(over.cause, 'eaten');
  assert.equal(over.by, bot.id);
  assert.equal(over.byName, bot.name);
  assert.equal(over.gen, gen);
  assert.equal(over.score, hole.score);
  assert.ok(over.score > 0);
  assert.equal(over.milestone, hole.milestone + 1);
  assert.ok(over.milestone >= 2);
  assert.ok(over.posted && over.posted.rank === 1);
  // Only the player's life was posted, under its nickname.
  assert.equal(posted.length, 1);
  assert.deepEqual(posted[0], { nickname: 'Alpha', score: over.score, tier: over.milestone, seconds: over.seconds, eaten: over.eaten });
  // Not at once, then a new life somewhere clear.
  assert.equal(room.play(a.player), false);
  run(room, NET.limits.playAgainDelay);
  assert.equal(room.play(a.player), true);
  assert.equal(hole.phase, 'playing');
  assert.equal(hole.gen, gen + 1);
  assert.ok(hole.protection > 0);
  assert.equal(hole.mass, hole.startMass);
  assert.ok(room.world.holes.includes(hole));
  assert.equal(room.play(a.player), false, 'only once');
  run(room, 0.2);
  const last = a.link.snapshots.at(-1)!;
  assert.equal(last.you.gen, gen + 1);
  assert.equal(last.you.phase, 'playing');
  // Its next life is scored afresh.
  rooms.leave(a.player);
  assert.equal(posted.length, 1, 'a fresh life with no points is not posted');
});

test('a player without a nickname is never posted; the board lists the arena by mass with the player\'s place', () => {
  const { rooms, posted } = arena({ population: 5 });
  const a = connect(rooms);
  const room = a.player.room!;
  assert.equal(a.player.named, false);
  a.player.hole!.mass = a.player.hole!.peakMass = holeMassForRadius(4);
  run(room, 1.2);
  const board = a.link.of('board').at(-1)!;
  assert.ok(board);
  assert.equal(board.players, 1);
  // Five bots until one steps aside, and the player.
  const inPlay = room.world.holes.filter((h) => !h.absent).length;
  assert.equal(board.holes, inPlay);
  assert.equal(board.rows.length, Math.min(NET.boardRows, inPlay));
  assert.ok(board.rows.every((r, i) => i === 0 || r[2] <= board.rows[i - 1][2]));
  const mine = board.rows.findIndex((r) => r[0] === a.player.hole!.id);
  assert.ok(mine >= 0);
  assert.deepEqual(board.you, [mine + 1, board.rows[mine][2]]);
  rooms.leave(a.player);
  assert.equal(posted.length, 0);
});

test('rooms run on real time: steps at SIM.tickRate, snapshots at NET.snapshotRate, a stall drops steps, empty rooms close', () => {
  const { rooms, clock } = arena({ population: 2, emptySeconds: 2 });
  const a = connect(rooms, 'Alpha');
  const room = a.player.room!;
  // The timer ticks every few milliseconds.
  const wait = (ms: number) => {
    for (const end = clock.now + ms; clock.now < end; ) {
      clock.now = Math.min(end, clock.now + 5);
      rooms.tick();
    }
  };
  wait(1000);
  assert.equal(room.world.tick, SIM.tickRate);
  assert.equal(a.link.snapshots.length, NET.snapshotRate);
  // A stall of 5 seconds catches up NET.maxCatchUpSteps steps only, then the room runs on.
  clock.now += 5000;
  rooms.tick();
  assert.equal(room.world.tick, SIM.tickRate + NET.maxCatchUpSteps);
  wait(500);
  assert.equal(room.world.tick, SIM.tickRate + NET.maxCatchUpSteps + SIM.tickRate / 2);
  // Empty for a while: closed.
  rooms.leave(a.player);
  wait(1000);
  assert.equal(rooms.rooms.length, 1);
  wait(1100);
  assert.equal(rooms.rooms.length, 0);
});

test('input: newest first, old or repeated ones refused, applied from the next step and acked in the snapshot', () => {
  const { rooms } = arena({ population: 0 });
  const a = connect(rooms, 'Alpha');
  const room = a.player.room!;
  const hole = a.player.hole!;
  assert.equal(room.input(a.player, { seq: 1, x: 1, z: 0 }), true);
  assert.equal(room.input(a.player, { seq: 1, x: 0, z: 1 }), false);
  assert.equal(room.input(a.player, { seq: 3, x: 0.6, z: -0.8 }), true);
  assert.equal(room.input(a.player, { seq: 2, x: 0, z: 1 }), false);
  const x = hole.position.x;
  run(room, 0.5);
  assert.ok(hole.position.x > x + 1, 'moved along the newest input');
  assert.equal(a.link.snapshots.at(-1)!.ack, 3);
});

test('a room that fails is closed and its players let go, and the other rooms run on', () => {
  const errors: unknown[] = [];
  const { rooms, clock } = arena({ population: 2, maxPlayers: 1, onError: (e) => errors.push(e) });
  const a = connect(rooms, 'Alpha');
  const b = connect(rooms, 'Beta');
  const broken = a.player.room!;
  const fine = b.player.room!;
  assert.notEqual(broken, fine);
  broken.world.step = () => {
    throw new Error('boom');
  };
  clock.now += 100;
  rooms.tick();
  assert.equal(errors.length, 1);
  assert.deepEqual(rooms.rooms, [fine]);
  assert.equal(a.player.room, null);
  assert.deepEqual(a.link.of('error'), [{ t: 'error', code: 'error' }]);
  assert.equal(a.link.closed?.code, 4008);
  assert.ok(fine.world.tick > 0);
  assert.equal(b.link.closed, null);
  // The player who was let go can quick play again.
  assert.ok(rooms.join(a.player, 'Alpha', 1.4));
});
