import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { NET } from '../../src/config/index.ts';
import { CLOSE, encodeInput, PROTOCOL_VERSION, rulesHash, type ServerMessage, type WelcomeMessage } from '../../src/protocol/messages.ts';
import { readSnapshot, type Snapshot } from '../../src/protocol/snapshot.ts';
import { Writer } from '../../src/protocol/wire.ts';
import { holeMassForRadius } from '../../src/sim/Hole.ts';
import { buildApp } from '../src/app.ts';
import type { ArenaOptions } from '../src/arena/Rooms.ts';

async function server(arena: Partial<ArenaOptions> = {}) {
  const app = await buildApp({ dbPath: ':memory:', submitPerMinute: 1000, requestsPerMinute: 10000, arena });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = (app.server.address() as AddressInfo).port;
  return { app, url: `ws://127.0.0.1:${port}${NET.path}`, http: `http://127.0.0.1:${port}` };
}

/** A headless game client: Node's own WebSocket, decoding what the server sends. */
class Client {
  readonly ws: WebSocket;
  readonly messages: ServerMessage[] = [];
  readonly snapshots: Snapshot[] = [];
  readonly closed: Promise<{ code: number; reason: string }>;
  readonly opened: Promise<boolean>;
  private seq = 0;
  private readonly writer = new Writer(16);
  private waiters: (() => void)[] = [];

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';
    this.opened = new Promise((resolve) => {
      this.ws.addEventListener('open', () => resolve(true));
      this.ws.addEventListener('error', () => resolve(false));
    });
    this.closed = new Promise((resolve) => this.ws.addEventListener('close', (e) => resolve({ code: e.code, reason: e.reason })));
    this.ws.addEventListener('message', (e) => {
      if (typeof e.data === 'string') this.messages.push(JSON.parse(e.data) as ServerMessage);
      else this.snapshots.push(readSnapshot(new Uint8Array(e.data as ArrayBuffer)));
      for (const wake of this.waiters.splice(0)) wake();
    });
  }

  send(message: object): void {
    this.ws.send(JSON.stringify(message));
  }

  async join(name: string, reach = 1.4): Promise<WelcomeMessage> {
    assert.ok(await this.opened, 'connected');
    this.send({ t: 'join', v: PROTOCOL_VERSION, rules: rulesHash(), name, reach });
    return (await this.until(() => this.messages.find((m) => m.t === 'welcome'))) as WelcomeMessage;
  }

  input(x: number, z: number): void {
    this.ws.send(encodeInput(this.writer, ++this.seq, x, z));
  }

  get last(): Snapshot {
    return this.snapshots[this.snapshots.length - 1];
  }

  /** Wait until `find` returns something (checked on every message), or fail after `ms`. */
  async until<T>(find: () => T | undefined | null | false, ms = 5000): Promise<T> {
    const end = Date.now() + ms;
    for (;;) {
      const found = find();
      if (found) return found;
      const left = end - Date.now();
      if (left <= 0) throw new Error('timed out waiting');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }
}

test('two players in one room over real WebSockets: they move, see each other, one eats the other and the server scores and posts the life', async () => {
  const { app, url, http } = await server({ population: 0 });
  try {
    const a = new Client(url);
    const b = new Client(url);
    const wa = await a.join('Alpha');
    const wb = await b.join('Beta', 2.4);
    assert.equal(wa.room, wb.room, 'quick play put them in one room');
    assert.equal(wa.name, 'Alpha');
    assert.ok(wa.named);
    assert.notEqual(wa.hole, wb.hole);
    assert.equal(wa.seed, wb.seed);
    assert.equal(wa.tickRate, 60);
    const online = (await (await fetch(`${http}/api/online`)).json()) as { players: number; rooms: number; load: number };
    assert.deepEqual({ players: online.players, rooms: online.rooms }, { players: 2, rooms: 1 });
    assert.ok(online.load >= 0 && online.load < 1, `load ${online.load}`);

    // Moving: the server steers each hole by its input and acks it.
    await a.until(() => a.snapshots.length > 0);
    const x0 = a.last.you.x;
    const moving = setInterval(() => {
      a.input(1, 0);
      b.input(0, -1);
    }, 40);
    await a.until(() => a.last.you.x > x0 + 2 && a.last.ack > 0);
    clearInterval(moving);
    assert.ok(a.snapshots.length >= 5);

    // They spawned out of each other's sight; bring Beta next to Alpha on the server and grow Alpha.
    const room = app.arena.rooms[0];
    const ha = room.world.hole(wa.hole)!;
    const hb = room.world.hole(wb.hole)!;
    ha.hunger.enabled = false;
    hb.hunger.enabled = false;
    ha.mass = ha.peakMass = holeMassForRadius(6);
    hb.mass = hb.peakMass = holeMassForRadius(1.5);
    ha.protection = hb.protection = 0;
    hb.position.x = ha.position.x + 30;
    hb.position.z = ha.position.z;
    hb.input.x = hb.input.z = ha.input.x = ha.input.z = 0;
    const seen = await a.until(() => a.last.holes.find((h) => h.id === wb.hole));
    assert.ok(seen.x > a.last.you.x, 'Beta to the right of Alpha');
    // Each client met the other with an intro carrying its name (the first record of it).
    const introA = a.snapshots.flatMap((s) => s.holes).find((h) => h.id === wb.hole && h.name !== null);
    assert.equal(introA?.name, 'Beta');
    const introB = await b.until(() => b.snapshots.flatMap((s) => s.holes).find((h) => h.id === wa.hole && h.name !== null));
    assert.equal(introB.name, 'Alpha');

    // Alpha swallows Beta.
    const scoreBefore = hb.score;
    assert.ok(scoreBefore > 0);
    hb.position.x = ha.position.x + 1;
    const over = await b.until(() => b.messages.find((m) => m.t === 'over'));
    assert.equal(over.t, 'over');
    if (over.t !== 'over') return;
    assert.equal(over.cause, 'eaten');
    assert.equal(over.by, wa.hole);
    assert.equal(over.byName, 'Alpha');
    // Its peak as the server saw it (it may have eaten a little dust since).
    assert.ok(over.score >= scoreBefore);
    assert.ok(over.posted, 'posted to the leaderboard');
    assert.equal(over.posted.rank, 1);
    // Alpha was told: the merger and its meal.
    const eaten = await a.until(() => a.snapshots.flatMap((s) => s.events).find((e) => e.type === 'holeEaten' && e.victim === wb.hole));
    assert.equal(eaten.type === 'holeEaten' && eaten.victimName, 'Beta');
    const meal = a.snapshots.flatMap((s) => s.events).find((e) => e.type === 'ate' && e.what?.hole);
    assert.equal(meal?.type === 'ate' && meal.what?.name, 'Beta');
    // On the board, as the server scored it.
    const top = (await (await fetch(`${http}/api/scores/top`)).json()) as { entries: { nickname: string; score: number }[] };
    assert.deepEqual(top.entries.map((e) => [e.nickname, e.score]), [['Beta', over.score]]);

    // Play again: a new life in the same room.
    const gen = b.last.you.gen;
    await new Promise((r) => setTimeout(r, NET.limits.playAgainDelay * 1000 + 50));
    b.send({ t: 'play' });
    const again = await b.until(() => b.snapshots.find((s) => s.you.gen === gen + 1 && s.you.phase === 'playing'));
    assert.ok(again.you.protection > 0);

    // A ping comes back.
    a.send({ t: 'ping', n: 42 });
    await a.until(() => a.messages.find((m) => m.t === 'pong' && m.n === 42));
    a.ws.close();
    b.ws.close();
    await Promise.all([a.closed, b.closed]);
    // Their holes leave the room as the server sees the sockets close.
    for (let i = 0; i < 100 && app.arena.players > 0; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(app.arena.players, 0);
    assert.equal(room.world.holes.length, 0);
  } finally {
    await app.close();
  }
});

test('the server turns away other versions, a full arena, floods, oversized messages and too many connections per IP', async () => {
  const { app, url } = await server({ population: 0, maxPlayers: 1, maxRooms: 1 });
  try {
    // Another build of the game.
    const stale = new Client(url);
    assert.ok(await stale.opened);
    stale.send({ t: 'join', v: PROTOCOL_VERSION, rules: rulesHash() ^ 1, name: 'Old' });
    assert.equal((await stale.closed).code, CLOSE.version);
    assert.deepEqual(stale.messages, [{ t: 'error', code: 'version' }]);

    // One room of one player: the next one is told the server is full.
    const first = new Client(url);
    await first.join('First');
    const second = new Client(url);
    assert.ok(await second.opened);
    second.send({ t: 'join', v: PROTOCOL_VERSION, rules: rulesHash(), name: 'Second' });
    assert.equal((await second.closed).code, CLOSE.full);

    // Garbage and floods: dropped with strikes, then closed.
    const flood = new Client(url);
    assert.ok(await flood.opened);
    for (let i = 0; i < NET.limits.burst + NET.limits.maxStrikes + 20; i++) flood.ws.send(i % 2 ? '{nope' : new Uint8Array([1, 2, 3]));
    assert.equal((await flood.closed).code, CLOSE.policy);

    // Bigger than any real message.
    const big = new Client(url);
    assert.ok(await big.opened);
    big.ws.send('x'.repeat(NET.limits.maxMessageBytes + 1));
    assert.equal((await big.closed).code, 1009);

    // Connections per IP (first is still open).
    const extra: Client[] = [];
    for (let i = 0; i < NET.limits.connectionsPerIp + 1; i++) extra.push(new Client(url));
    const opened = await Promise.all(extra.map((c) => c.opened));
    assert.equal(opened.filter(Boolean).length, NET.limits.connectionsPerIp - 1);
    for (const c of [first, ...extra]) c.ws.close();
  } finally {
    await app.close();
  }
});
