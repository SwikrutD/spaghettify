import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMETS, NET } from '../../src/config/index.ts';
import type { RunSubmission } from '../../src/leaderboard/rules.ts';
import { decodeInput, encodeInput } from '../../src/protocol/messages.ts';
import { BODY_KIND, readSnapshot, writeEvent, writeHeader, writeYou } from '../../src/protocol/snapshot.ts';
import { packLog, Reader, unpackLog, Writer } from '../../src/protocol/wire.ts';
import type { SimEvent } from '../../src/sim/events.ts';
import { holeMassForRadius, viewDistance, type Hole, type Meal } from '../../src/sim/Hole.ts';
import { Player } from '../src/arena/Player.ts';
import { Room } from '../src/arena/Room.ts';
import { Mirror, TestLink } from './helpers.ts';

function makeRoom(seed: number, population = 12): { room: Room; posted: RunSubmission[] } {
  const posted: RunSubmission[] = [];
  const room = new Room(1, { population, maxPlayers: 12, minBots: 0, seed }, (run) => {
    posted.push(run);
    return { rank: 1, total: 1, best: run.score, personalBest: true };
  });
  return { room, posted };
}

function addPlayer(room: Room, name?: string, reach?: number): { player: Player; link: TestLink } {
  const link = new TestLink();
  const player = new Player(link);
  const welcome = room.join(player, name, reach);
  link.mirror = new Mirror(welcome.seed);
  return { player, link };
}

/** Run the room for `seconds` the way the server does: steps, a snapshot every few. `each` runs before every step. */
function play(room: Room, seconds: number, each?: (tick: number) => void, check?: () => void): void {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) {
    each?.(room.world.tick);
    room.step();
    if (room.world.tick % 3 === 0) {
      room.broadcast();
      check?.();
    }
  }
}

function near(a: number, b: number, tolerance: number, what: string): void {
  assert.ok(Math.abs(a - b) <= tolerance, `${what}: ${a} vs ${b}`);
}

/**
 * The client's picture, right after a snapshot, against the server's world: every hole, body, comet, debris
 * fragment and falling grain near it is there as it is on the server, nothing it has is stale, and every cell of its
 * synced field rectangles has exactly the server's grains.
 */
function checkMirror(room: Room, player: Player, link: TestLink): void {
  const world = room.world;
  const mirror = link.mirror!;
  const interest = player.interest!;
  const s = mirror.last!;
  const R = interest.radius;
  const cx = interest.cx;
  const cz = interest.cz;
  const I = NET.interest;
  const dist = (x: number, z: number) => Math.hypot(x - cx, z - cz);
  // Your own hole at full precision.
  const own = player.hole!;
  assert.equal(s.you.gen, own.gen);
  assert.equal(s.you.phase, own.phase);
  near(s.you.x, own.position.x, 1e-3, 'you.x');
  near(s.you.vz, own.velocity.z, 1e-3, 'you.vz');
  near(s.you.radius, own.radius, 1e-5 * own.radius, 'you.radius');
  near(s.you.mass, own.mass, 1e-5 * own.mass, 'you.mass');
  near(s.you.protection, own.protection, 0.021, 'you.protection');
  assert.ok(!mirror.holes.has(own.id), 'your hole is only in "you"');
  // The other holes.
  for (const h of world.holes) {
    if (h === own) continue;
    const m = mirror.holes.get(h.id);
    const inside = h.phase !== 'over' && dist(h.position.x, h.position.z) < R + I.holeMargin * h.radius;
    if (inside) assert.ok(m, `hole ${h.name} near the client is missing`);
    if (!m) continue;
    assert.equal(m.gen, h.gen, `${h.name} gen`);
    assert.equal(m.name, h.name);
    assert.equal(m.phase, h.phase);
    near(m.x, h.position.x, s.unit, `${h.name} x`);
    near(m.z, h.position.z, s.unit, `${h.name} z`);
    near(m.radius, h.radius, h.radius * 4e-4, `${h.name} radius`);
    near(m.mass, h.mass, h.mass * 4e-4, `${h.name} mass`);
  }
  for (const id of mirror.holes.keys()) assert.ok(world.hole(id), `stale hole ${id}`);
  // Pooled bodies.
  const pools = [
    { kind: BODY_KIND.prey, list: world.prey.objects, live: (b: { state: string }) => b.state !== 'gone', margin: 1, pad: 0 },
    { kind: BODY_KIND.comet, list: world.comets.objects, live: (b: { active: boolean }) => b.active, margin: I.cometMargin, pad: COMETS.tailLengthView * viewDistance(own.radius) },
    { kind: BODY_KIND.debris, list: world.debris.objects, live: (b: { active: boolean }) => b.active, margin: 1, pad: 0 },
    { kind: BODY_KIND.infall, list: world.field.infall, live: (b: { active: boolean }) => b.active, margin: 1, pad: 0 },
  ] as const;
  for (const pool of pools) {
    const have = mirror.bodies[pool.kind];
    pool.list.forEach((body, slot) => {
      const live = (pool.live as (b: unknown) => boolean)(body);
      const m = have.get(slot);
      if (live && dist(body.position.x, body.position.z) <= R + body.radius * pool.margin + pool.pad) assert.ok(m, `${body.className} ${slot} near the client is missing`);
      if (!m) return;
      assert.ok(live, `${body.className} ${slot} is gone on the server`);
      assert.equal(m.gen, body.gen);
      assert.equal(m.state, body.state);
      near(m.radius, body.radius, 1e-5 * body.radius, 'body radius');
      if (pool.kind === BODY_KIND.prey) near(m.x, body.position.x, body.radius * (NET.interest.preyMoveTolerance + 1e-3), 'body x');
    });
  }
  // The field: every cell in every synced rectangle as the server has it.
  const field = world.field;
  const view = viewDistance(own.radius);
  for (const layer of field.layers) {
    const rect = mirror.rects.get(layer.index);
    const synced = rect !== undefined && rect.c1 >= rect.c0;
    if (layer.def.radius[1] >= I.fieldMinSize * view) {
      assert.ok(synced, `layer ${layer.def.name} should be synced`);
      assert.ok(rect.c0 <= layer.col(cx - R) && rect.c1 >= layer.col(cx + R) && rect.r0 <= layer.col(cz - R) && rect.r1 >= layer.col(cz + R), 'rectangle covers the area');
    }
    if (!synced) continue;
    for (let row: number = rect.r0; row <= rect.r1; row++) {
      for (let col: number = rect.c0; col <= rect.c1; col++) {
        const cell: number = row * layer.cols + col;
        const live: number = field.liveIn(layer.index, cell);
        const seen: number = mirror.world.field.liveIn(layer.index, cell);
        assert.equal(seen, live, `${layer.def.name} cell ${cell}: client ${seen.toString(2)} server ${live.toString(2)}`);
      }
    }
  }
}

test('wire: varints, strings, log-packed numbers and the input frame round trip', () => {
  const w = new Writer(8);
  const ints = [0, 1, 127, 128, 16383, 16384, 2 ** 31 + 5, 2 ** 40];
  for (const v of ints) w.varint(v);
  const texts = ['', 'Pea', 'Ünïcode_ok-1.2', 'x'.repeat(300)];
  for (const t of texts) w.string(t);
  const r = new Reader(w.bytes());
  for (const v of ints) assert.equal(r.varint(), v);
  for (const t of texts) assert.equal(r.string(), t);
  assert.equal(r.remaining, 0);
  assert.throws(() => r.u8());
  for (const v of [0.001, 0.25, 1, 3.5, 200, 1e6]) near(unpackLog(packLog(v)), v, v * 3.4e-4, `log ${v}`);
  assert.equal(unpackLog(packLog(0)), 0);
  const frame = decodeInput(encodeInput(new Writer(), 77, 3, -4), { seq: 0, x: 0, z: 0 })!;
  assert.equal(frame.seq, 77);
  // Clamped to the unit square on the wire, then to length 1.
  near(Math.hypot(frame.x, frame.z), 1, 1e-6, 'input length');
  assert.equal(decodeInput(new Uint8Array(5), frame), null);
});

test('events round trip through a snapshot as the same SimEvents', () => {
  const { room } = makeRoom(301, 2);
  const hole = room.world.holes[0];
  const events: SimEvent[] = [
    { type: 'ate', hole: 3, mass: 0.02, gained: 0.02, holeMass: 0.3, holeRadius: 0.53, what: { name: 'dust grain', radius: 0.1 }, reclaimed: false, biggest: true },
    { type: 'ate', hole: 3, mass: 2, gained: 1.6, holeMass: 5, holeRadius: 2, what: { name: 'Silent Quasar', radius: 1.5, hole: true }, reclaimed: false, biggest: false },
    { type: 'ate', hole: 3, mass: 1, gained: 1, holeMass: 5, holeRadius: 2, what: null, reclaimed: true, biggest: false },
    { type: 'bumped', hole: 4, x: 10.5, z: -3.25, radius: 2, nx: 0.6, nz: -0.8, by: 'comet' },
    { type: 'shed', hole: 4, mass: 0.5 },
    { type: 'milestone', hole: 3, index: 4 },
    { type: 'holeEaten', eater: 3, victim: 9, eaterName: 'Pea', victimName: 'Kerr-7', x: 1, z: 2, eaterRadius: 3, victimRadius: 2, gained: 4 },
    { type: 'died', hole: 9, cause: 'eaten', by: 3, byName: 'Pea' },
    { type: 'died', hole: 9, cause: 'evaporated', by: -1, byName: '' },
  ];
  const w = new Writer();
  const at = writeHeader(w, 12, 34, 1);
  writeYou(w, hole);
  w.u16(0);
  w.u16(events.length);
  for (const e of events) writeEvent(w, e);
  w.patchU8(at, 16);
  const s = readSnapshot(w.bytes());
  assert.equal(s.tick, 12);
  assert.equal(s.ack, 34);
  assert.equal(s.events.length, events.length);
  for (let i = 0; i < events.length; i++) {
    const got = s.events[i] as unknown as Record<string, unknown>;
    const want = events[i] as unknown as Record<string, unknown>;
    for (const key of Object.keys(want)) {
      const g = got[key];
      const x = want[key];
      if (typeof x === 'number') {
        near(g as number, x, 0.01, `${want.type}.${key}`);
      } else if (x && typeof x === 'object') {
        const meal = x as Meal;
        assert.deepEqual({ ...(g as Meal), radius: 0 }, { ...meal, radius: 0 });
        near((g as Meal).radius, meal.radius, 1e-6, 'meal radius');
      } else {
        assert.equal(g, x, `${want.type}.${key}`);
      }
    }
  }
});

test('interest management: each client sees exactly what is near it, bodies and cells only when they change, and its field matches the server cell for cell', () => {
  const { room } = makeRoom(302);
  const a = addPlayer(room, 'Alpha', 1.3);
  const b = addPlayer(room, 'Beta', 2.4);
  const c = addPlayer(room, 'Gamma');
  const players = [a, b, c];
  let checks = 0;
  // They roam the arena on slow curves, eating what they meet; the bots do their own thing. Now and then another
  // hole is dropped next to one of them (holes meet rarely on their own), and wanders off again.
  const holes = room.world.holes;
  play(
    room,
    45,
    (tick) => {
      players.forEach(({ player }, i) => {
        const angle = tick * (0.004 + i * 0.002) + i * 2.1;
        player.hole!.input.x = Math.cos(angle);
        player.hole!.input.z = Math.sin(angle);
      });
      if (tick % 180 === 90) {
        const target = players[(tick / 180) % 3 | 0].player;
        const visitor = holes[(tick / 7) % holes.length | 0];
        if (visitor === target.hole || visitor.phase !== 'playing') return;
        const R = target.interest!.radius;
        visitor.position.x = target.hole!.position.x + R * 0.6;
        visitor.position.z = target.hole!.position.z - R * 0.3;
        visitor.capture();
      }
    },
    () => {
      if (room.world.tick % 30 !== 0) return;
      for (const { player, link } of players) {
        if (player.hole!.phase !== 'playing') continue;
        checkMirror(room, player, link);
        checks++;
      }
    },
  );
  assert.ok(checks > 100);
  // They saw other holes come and go.
  for (const { link } of players) {
    assert.ok(link.snapshots.some((x) => x.holes.length > 0), 'saw another hole');
    assert.ok(link.snapshots.some((x) => x.gone.length > 0), 'saw one leave');
  }
  // Something happened in the field around them (eaten grains and their infall streams were sent).
  const eaten = players.reduce((n, { player }) => n + player.hole!.eatenCount, 0);
  assert.ok(eaten > 20, `only ${eaten} meals`);
  assert.ok(players.some(({ link }) => link.snapshots.some((s) => s.cells.length > 0)));
  assert.ok(players.some(({ link }) => link.snapshots.some((s) => s.bodies.some((x) => x.kind === BODY_KIND.infall))));
  // Most snapshots carry no body or cell records at all: only what changed is sent.
  const quiet = a.link.snapshots.filter((s) => s.bodies.length === 0 && s.cells.length === 0).length;
  assert.ok(quiet > a.link.snapshots.length * 0.3, `${quiet} of ${a.link.snapshots.length} quiet`);
  // Own meals come as events to the eater only.
  for (const { player, link } of players) {
    const ate = link.snapshots.flatMap((s) => s.events).filter((e) => e.type === 'ate');
    assert.ok(ate.every((e) => e.hole === player.hole!.id));
  }
});

test('a client that misses snapshots (fell behind) gets its whole field area again and stays exact', () => {
  const { room } = makeRoom(303, 6);
  const a = addPlayer(room, 'Alpha');
  const steer = (tick: number) => {
    const angle = tick * 0.01;
    a.player.hole!.input.x = Math.cos(angle);
    a.player.hole!.input.z = Math.sin(angle);
  };
  play(room, 5, steer);
  checkMirror(room, a.player, a.link);
  const before = a.link.snapshots.length;
  a.link.buffered = NET.limits.skipBytes + 1;
  play(room, 2, steer);
  assert.equal(a.link.snapshots.length, before, 'no snapshots while behind');
  a.link.buffered = 0;
  play(room, 0.05, steer);
  assert.ok(a.link.snapshots.length > before);
  checkMirror(room, a.player, a.link);
  play(room, 5, steer, () => {
    if (room.world.tick % 30 === 0) checkMirror(room, a.player, a.link);
  });
  // Far behind: let go.
  a.link.buffered = NET.limits.maxBufferedBytes + 1;
  play(room, 0.05);
  assert.equal(a.link.closed?.reason, 'slow');
});

test('a big hole syncs only the layers it can see, and the whole arena of them', () => {
  const { room } = makeRoom(304, 2);
  const a = addPlayer(room, 'Alpha');
  const hole: Hole = a.player.hole!;
  hole.hunger.enabled = false;
  hole.mass = holeMassForRadius(40);
  hole.radius = hole.radiusForMass();
  play(room, 0.2);
  const rects = a.link.mirror!.rects;
  const view = viewDistance(hole.radius);
  for (const layer of room.world.field.layers) {
    const rect = rects.get(layer.index);
    const synced = rect !== undefined && rect.c1 >= rect.c0;
    assert.equal(synced, layer.def.radius[1] >= NET.interest.fieldMinSize * view, layer.def.name);
  }
  checkMirror(room, a.player, a.link);
  // And back small: the dust comes back, exact.
  hole.mass = hole.startMass * 1.1;
  hole.radius = hole.radiusForMass();
  play(room, 0.2);
  checkMirror(room, a.player, a.link);
});

test('bandwidth: a full room of wandering players stays within a few KB per second each', () => {
  const { room } = makeRoom(305);
  const players = [0, 1, 2, 3, 4, 5].map((i) => addPlayer(room, `P${i}`, i % 2 ? 1.3 : 2.4));
  const seconds = 60;
  play(room, seconds, (tick) => {
    players.forEach(({ player }, i) => {
      const hole = player.hole!;
      if (hole.phase === 'over') room.play(player);
      const angle = tick * 0.006 * (1 + i * 0.3) + i;
      hole.input.x = Math.cos(angle);
      hole.input.z = Math.sin(angle);
    });
  });
  const rates = players.map(({ link }) => link.bytes / seconds);
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  console.log(`snapshot bytes per second per player: mean ${mean.toFixed(0)}, max ${Math.max(...rates).toFixed(0)}`);
  assert.ok(mean < 6000, `mean ${mean}`);
});
