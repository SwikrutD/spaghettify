import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NET, NET_CLIENT, PLAYER } from '../../src/config/index.ts';
import { decodeInput, type ClientMessage, type InputFrame, type ServerMessage } from '../../src/protocol/messages.ts';
import { readSnapshot } from '../../src/protocol/snapshot.ts';
import { holeMassForRadius, viewDistance } from '../../src/sim/Hole.ts';
import { Rng } from '../../src/sim/rng.ts';
import { OnlineArena, type Incoming } from '../../src/net/OnlineArena.ts';
import type { Link } from '../src/arena/Player.ts';
import { Player } from '../src/arena/Player.ts';
import { Room } from '../src/arena/Room.ts';

const STEP_MS = 1000 / 60;

/**
 * A simulated network between a room and one game client (the real OnlineArena): messages each way arrive after a
 * delay in steps, plus up to `jitter` more, in order (as over TCP). The test runs both sides in lockstep at 60 steps a
 * second: deliver what is due, step the room (snapshots every 3 steps), deliver, then one client frame.
 */
class Wire implements Link {
  readonly player: Player;
  arena!: OnlineArena;
  buffered = 0;
  closed: { code: number; reason: string } | null = null;
  private readonly down: { at: number; m: Incoming }[] = [];
  private readonly up: { at: number; m: Uint8Array | ClientMessage }[] = [];
  private readonly room: Room;
  private readonly latency: { up: number; down: number; jitter: number };
  private readonly rng: Rng;
  private readonly frame: InputFrame = { seq: 0, x: 0, z: 0 };
  private lastDown = 0;
  private lastUp = 0;
  readonly json: (message: ServerMessage) => void;

  constructor(room: Room, latency: { up: number; down: number; jitter: number }, seed: number) {
    this.room = room;
    this.latency = latency;
    this.rng = new Rng(seed);
    this.player = new Player(this);
    this.json = (message) => this.toClient(JSON.parse(JSON.stringify(message)) as ServerMessage);
  }

  join(name: string, reach = 1.4): OnlineArena {
    const welcome = this.room.join(this.player, name, reach);
    this.arena = new OnlineArena(
      JSON.parse(JSON.stringify(welcome)),
      {
        sendBinary: (bytes) => this.toServer(bytes),
        send: (message) => this.toServer(message),
      },
      reach,
    );
    return this.arena;
  }

  binary(data: Uint8Array): void {
    this.toClient(readSnapshot(data));
  }

  close(code: number, reason: string): void {
    this.closed = { code, reason };
  }

  private delay(base: number, last: number): number {
    const at = this.room.world.tick + base + Math.floor(this.rng.next() * (this.latency.jitter + 1));
    return Math.max(at, last);
  }

  private toClient(m: Incoming): void {
    this.lastDown = this.delay(this.latency.down, this.lastDown);
    this.down.push({ at: this.lastDown, m });
  }

  private toServer(m: Uint8Array | ClientMessage): void {
    this.lastUp = this.delay(this.latency.up, this.lastUp);
    this.up.push({ at: this.lastUp, m });
  }

  /** Hand the room what has arrived by now. */
  deliverUp(): void {
    const tick = this.room.world.tick;
    while (this.up.length > 0 && this.up[0].at <= tick) {
      const m = this.up.shift()!.m;
      if (m instanceof Uint8Array) {
        const frame = decodeInput(m, this.frame);
        if (frame) this.room.input(this.player, frame);
      } else if (m.t === 'play') {
        this.room.play(this.player);
      } else if (m.t === 'view') {
        this.room.view(this.player, m.reach);
      }
    }
  }

  /** Hand the client what has arrived by now. */
  deliverDown(nowMs: number): void {
    const tick = this.room.world.tick;
    while (this.down.length > 0 && this.down[0].at <= tick) this.arena.receive(this.down.shift()!.m, nowMs);
  }
}

function makeRoom(seed: number, population = 0): Room {
  return new Room(1, { population, maxPlayers: 12, minBots: 0, seed }, () => null);
}

/** Run room and clients in lockstep for `steps` steps. `steer` gives each client's input; `each` runs after every step. */
function run(room: Room, wires: Wire[], steps: number, steer: (wire: Wire, tick: number) => [number, number], each?: () => void): void {
  for (let i = 0; i < steps; i++) {
    for (const w of wires) w.deliverUp();
    room.step();
    if (room.world.tick % 3 === 0) room.broadcast();
    const now = room.world.tick * STEP_MS;
    for (const w of wires) {
      w.deliverDown(now);
      const [x, z] = steer(w, room.world.tick);
      w.arena.update(1 / 60, x, z, now);
    }
    each?.();
  }
}

/** A calm room: no field, no pull, no comets reaching anyone (the own hole moves by its input and the gas wall only). */
function calm(room: Room): void {
  room.world.field.enabled = false;
  room.world.dangers.enabled = false;
}

/** Input that changes sharply every half second (a new random heading and throttle). */
function jerky(seed: number): (wire: Wire, tick: number) => [number, number] {
  const rng = new Rng(seed);
  let x = 0;
  let z = 0;
  return (_wire, tick) => {
    if (tick % 30 === 0) {
      const a = rng.next() * Math.PI * 2;
      const m = 0.3 + rng.next() * 0.7;
      x = Math.cos(a) * m;
      z = Math.sin(a) * m;
    }
    return [x, z];
  };
}

test('prediction: with a steady link the own hole is predicted exactly, whatever the input does', () => {
  const room = makeRoom(401);
  calm(room);
  const wire = new Wire(room, { up: 4, down: 5, jitter: 0 }, 1);
  const arena = wire.join('Alpha');
  const steer = jerky(7);
  const hole = room.world.hole(arena.local.id)!;
  hole.hunger.enabled = false;
  // The prediction runs ahead of the server by the round trip: keep where it put the hole for each server step, and
  // compare once the server gets there.
  const predicted = new Map<number, { x: number; z: number }>();
  let compared = 0;
  let worst = 0;
  run(room, [wire], 60 * 20, steer, () => {
    const p = arena.prediction;
    if (p.lead === null || room.world.tick < 120) return;
    predicted.set(p.tick - p.lead, { x: arena.local.position.x, z: arena.local.position.z });
    const at = predicted.get(room.world.tick);
    if (!at) return;
    worst = Math.max(worst, Math.hypot(hole.position.x - at.x, hole.position.z - at.z));
    compared++;
  });
  assert.ok(compared > 1000, `compared ${compared}`);
  // The predicted step and the server's step it stands for are the same place (float32 on the wire aside).
  assert.ok(worst < 1e-3, `worst ${worst}`);
  // So every snapshot finds nothing to correct, and the lead is the link's: up 4 steps, plus the step that uses it.
  const p = arena.prediction;
  assert.ok(p.lastError < 1e-3, `last correction ${p.lastError}`);
  assert.equal(p.snaps, 0);
  // A snapshot is replayed forward by the round trip: 5 steps down and 4 up.
  assert.equal(p.replayed, 9);
});

test('prediction: network jitter makes small corrections that fade, never snaps, and the drawn hole stays close', () => {
  const room = makeRoom(402);
  calm(room);
  const wire = new Wire(room, { up: 3, down: 3, jitter: 3 }, 2);
  const arena = wire.join('Alpha');
  const hole = room.world.hole(arena.local.id)!;
  hole.hunger.enabled = false;
  const steer = jerky(8);
  let worstDrawn = 0;
  let maxCorrection = 0;
  run(room, [wire], 60 * 20, steer, () => {
    if (room.world.tick < 120) return;
    maxCorrection = Math.max(maxCorrection, arena.prediction.lastError);
    // How far the drawn hole is from the server's hole now, in the hole's own radii (it leads by the round trip).
    const drawnX = arena.local.position.x + arena.drawOffset.x;
    const drawnZ = arena.local.position.z + arena.drawOffset.z;
    worstDrawn = Math.max(worstDrawn, Math.hypot(drawnX - hole.position.x, drawnZ - hole.position.z));
  });
  assert.equal(arena.prediction.snaps, 0);
  // A step or two of input timing at full speed: well under the hole's own radius.
  assert.ok(maxCorrection < PLAYER.startRadius * 0.6, `max correction ${maxCorrection}`);
  // Up to 12 steps of round trip at 9 units a second ahead of the server (about 1.8 units at most).
  assert.ok(worstDrawn < 1.8, `drawn ${worstDrawn} from the server's hole`);
});

test('prediction: a stall (a hidden tab) and a teleport are caught up without a fuss', () => {
  const room = makeRoom(403);
  calm(room);
  const wire = new Wire(room, { up: 3, down: 4, jitter: 1 }, 3);
  const arena = wire.join('Alpha');
  const hole = room.world.hole(arena.local.id)!;
  hole.hunger.enabled = false;
  const steer = jerky(9);
  run(room, [wire], 300, steer);
  const lead = arena.prediction.lead!;
  assert.notEqual(lead, null);
  // The client draws no frames for 3 seconds while the room runs on (the snapshots still arrive).
  for (let i = 0; i < 180; i++) {
    wire.deliverUp();
    room.step();
    if (room.world.tick % 3 === 0) room.broadcast();
    wire.deliverDown(room.world.tick * STEP_MS);
  }
  run(room, [wire], 120, steer);
  // The lead jumped by about the stall (the client's own count of steps fell behind the server's).
  assert.ok(arena.prediction.lead! < lead - 100, `lead ${lead} then ${arena.prediction.lead}`);
  let worst = 0;
  run(room, [wire], 300, steer, () => (worst = Math.max(worst, arena.prediction.lastError)));
  assert.ok(worst < 0.5, `after the stall: ${worst}`);
  // Teleported on the server: the client snaps to it rather than sliding across the arena.
  const snaps = arena.prediction.snaps;
  hole.position.x += 400;
  run(room, [wire], 30, steer);
  assert.equal(arena.prediction.snaps, snaps + 1);
  assert.ok(Math.abs(arena.local.position.x - hole.position.x) < 5);
});

test('other holes are drawn in the past, smoothly between snapshots, and the own hole sees them by name', () => {
  const room = makeRoom(404);
  calm(room);
  const a = new Wire(room, { up: 2, down: 3, jitter: 2 }, 4);
  const b = new Wire(room, { up: 2, down: 3, jitter: 2 }, 5);
  const arenaA = a.join('Alpha');
  const arenaB = b.join('Beta');
  const ha = room.world.hole(arenaA.local.id)!;
  const hb = room.world.hole(arenaB.local.id)!;
  ha.hunger.enabled = hb.hunger.enabled = false;
  ha.protection = hb.protection = 0;
  // Beta near Alpha (well inside its view), going round in a circle beside it.
  hb.position.x = ha.position.x + 9;
  hb.position.z = ha.position.z;
  const path = new Map<number, { x: number; z: number }>();
  let compared = 0;
  let worst = 0;
  run(
    room,
    [a, b],
    60 * 8,
    (w, tick) => (w === a ? [0, 0] : [0.6 * Math.cos(tick * 0.03 + 1.6 + Math.PI), 0.6 * Math.sin(tick * 0.03 + 1.6 + Math.PI)]),
    () => {
      path.set(room.world.tick, { x: hb.position.x, z: hb.position.z });
      const seen = arenaA.world.hole(hb.id);
      if (!seen || room.world.tick < 60) return;
      // Where the server had Beta at the drawing time of Alpha's client.
      const t = arenaA.clock.tick(room.world.tick * STEP_MS) - NET_CLIENT.interpDelay * 60;
      const p0 = path.get(Math.floor(t));
      const p1 = path.get(Math.floor(t) + 1);
      if (!p0 || !p1) return;
      const f = t - Math.floor(t);
      const x = p0.x + (p1.x - p0.x) * f;
      const z = p0.z + (p1.z - p0.z) * f;
      worst = Math.max(worst, Math.hypot(seen.position.x - x, seen.position.z - z));
      compared++;
    },
  );
  assert.ok(compared > 300, `compared ${compared}`);
  // On a curve, between snapshots three steps apart: a few thousandths of a unit.
  assert.ok(worst < 0.02, `worst ${worst}`);
  assert.equal(arenaA.world.hole(hb.id)?.name, 'Beta');
  assert.equal(arenaB.world.hole(ha.id)?.name, 'Alpha');
});

test('one client eats the other: the swallow, the server\'s account of the life, Play again and a new life', () => {
  const room = makeRoom(405);
  calm(room);
  const a = new Wire(room, { up: 2, down: 3, jitter: 1 }, 6);
  const b = new Wire(room, { up: 2, down: 3, jitter: 1 }, 7);
  const arenaA = a.join('Alpha');
  const arenaB = b.join('Beta');
  const ha = room.world.hole(arenaA.local.id)!;
  const hb = room.world.hole(arenaB.local.id)!;
  ha.hunger.enabled = hb.hunger.enabled = false;
  ha.mass = ha.peakMass = holeMassForRadius(6);
  hb.mass = hb.peakMass = holeMassForRadius(1.5);
  ha.protection = hb.protection = 0;
  hb.position.x = ha.position.x + 20;
  hb.position.z = ha.position.z;
  const still = (): [number, number] => [0, 0];
  run(room, [a, b], 60, still);
  assert.ok(arenaA.world.hole(hb.id), 'Alpha sees Beta');
  const overs: string[] = [];
  arenaB.onOver = (m) => overs.push(m.byName);
  let fell = 0;
  hb.position.x = ha.position.x + 1;
  run(room, [a, b], 120, still, () => {
    if (arenaB.local.phase === 'eaten') fell = Math.max(fell, arenaB.local.eatProgress);
  });
  assert.deepEqual(overs, ['Alpha']);
  assert.equal(arenaB.over?.cause, 'eaten');
  assert.equal(arenaB.local.phase, 'over');
  assert.ok(fell > 0.5, `fell ${fell}`);
  // Each side heard of the merger; Alpha counts the hole it ate.
  const kinds = (arena: OnlineArena) => arena.world.events.map((e) => e.type);
  assert.ok(kinds(arenaA).includes('holeEaten'));
  assert.ok(kinds(arenaB).includes('died'));
  assert.equal(arenaA.local.holesEaten, 1);
  assert.equal(arenaB.local.eatenByName, 'Alpha');
  // Play again: sent once the server takes it, and the new life starts afresh (a pea, protected).
  let lives = 0;
  arenaB.onNewLife = () => lives++;
  const gen = arenaB.local.gen;
  arenaB.playAgain();
  run(room, [a, b], 90, still);
  assert.equal(lives, 1);
  assert.equal(arenaB.local.gen, gen + 1);
  assert.equal(arenaB.local.phase, 'playing');
  assert.ok(arenaB.local.protection > 0);
  assert.ok(Math.abs(arenaB.local.position.x - hb.position.x) < 0.5);
});

test('the client mirror matches the server around it: bodies, falls and the field cell for cell', () => {
  const room = makeRoom(406, 8);
  const wires = [0, 1, 2].map((i) => new Wire(room, { up: 0, down: 0, jitter: 0 }, 10 + i));
  const arenas = wires.map((w, i) => w.join(`P${i}`, i === 1 ? 2.4 : 1.4));
  let checks = 0;
  run(
    room,
    wires,
    60 * 30,
    (w, tick) => {
      const i = wires.indexOf(w);
      const angle = tick * (0.004 + i * 0.002) + i * 2.1;
      return [Math.cos(angle), Math.sin(angle)];
    },
    () => {
      if (room.world.tick % 30 !== 3) return;
      wires.forEach((w, i) => {
        if (w.player.hole!.phase !== 'playing') return;
        checkField(room, w, arenas[i]);
        checks++;
      });
    },
  );
  assert.ok(checks > 100);
  // They ate along the way, and saw it.
  assert.ok(arenas.some((a) => a.local.eatenCount > 10));
});

/**
 * Right after a snapshot (no delay on the wire): every cell of every synced rectangle is as on the server, and every
 * arena body the client has is the server's (same life, state and place).
 */
function checkField(room: Room, wire: Wire, arena: OnlineArena): void {
  const field = room.world.field;
  const mirror = arena.mirror;
  const view = viewDistance(wire.player.hole!.radius);
  for (const layer of field.layers) {
    const shown = mirror.sight.layerShown(layer.index);
    // Every layer big enough to see is synced (and a layer far too small to see is not).
    if (layer.def.radius[1] >= NET.interest.fieldMinSize * view) assert.ok(shown, `${layer.def.name} should be shown`);
    if (layer.def.radius[1] < NET.interest.fieldMinSize * NET.interest.layerHysteresis * view) assert.ok(!shown, `${layer.def.name} should not be shown`);
    if (!shown) continue;
    const k = layer.index * 4;
    for (let row = mirror.rects[k + 1]; row <= mirror.rects[k + 3]; row++) {
      for (let col = mirror.rects[k]; col <= mirror.rects[k + 2]; col++) {
        const cell = row * layer.cols + col;
        assert.ok(mirror.sight.cellShown(layer.index, cell));
        assert.equal(arena.world.field.liveIn(layer.index, cell), field.liveIn(layer.index, cell), `${layer.def.name} cell ${cell}`);
      }
    }
  }
  room.world.prey.objects.forEach((body, slot) => {
    const seen = arena.world.prey.objects[slot];
    if (seen.state === 'gone') return;
    assert.equal(seen.gen, body.gen, `body ${slot} life`);
    assert.equal(seen.state, body.state, `body ${slot} state`);
    assert.ok(Math.abs(seen.position.x - body.position.x) < body.radius * (NET.interest.preyMoveTolerance + 1e-3), `body ${slot} x`);
  });
}
