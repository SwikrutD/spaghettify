/**
 * Load test for the online arena: how much CPU, memory and bandwidth a room costs, to size NET.rooms for the box
 * the server runs on. Not part of `npm test`; run by hand (numbers go to Progress.md):
 *
 *   npm run load -- sim [--rooms 4] [--players 12] [--seconds 180] [--radius 0]
 *     Rooms in this process, stepped as fast as they go (no sockets): the time a room takes per second of play is
 *     its CPU cost. Players are flown by the bots' own brain (they feed, hunt, flee, die and play again), so they
 *     grow and fight like real players. --radius starts every player's life around that radius (big holes see more).
 *
 *   npm run load -- ws [--clients 48] [--seconds 60] [--max-rooms 8] [--no-pilot] [--url ws://localhost:8095/ws]
 *     Real WebSocket clients against a real server: by default a server in a child process (its CPU, event loop
 *     delay and memory are reported), else the server at --url (for example the Docker deploy through Caddy; watch
 *     `docker stats` for its CPU). Clients send input 30 times a second like the game and play again when eaten.
 *     The local server flies their holes with the bots' brain as above; each client gets its own made-up
 *     X-Forwarded-For address so the per-IP limits see separate players.
 */
import { fork, type ChildProcess } from 'node:child_process';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { NET } from '../../src/config/index.ts';
import { encodeInput, PROTOCOL_VERSION, rulesHash, type ServerMessage } from '../../src/protocol/messages.ts';
import { Writer } from '../../src/protocol/wire.ts';
import type { BotBrain } from '../../src/sim/Bots.ts';
import type { Hole } from '../../src/sim/Hole.ts';
import type { World } from '../../src/sim/World.ts';
import { buildApp } from '../src/app.ts';
import { Player, type Link } from '../src/arena/Player.ts';
import { Room } from '../src/arena/Room.ts';

const args = process.argv.slice(2);
const mode = args[0] ?? 'sim';
function option(name: string, fallback: number): number {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
}
function text(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
};
const fmt = (n: number, digits = 1) => n.toFixed(digits);

/**
 * Flies players' holes with the bots' brain: for one call of the world's Bots, the players' holes carry a brain and
 * the real bots none, so only the players decide and steer (the real bots are steered by the world's own step).
 */
class Pilot {
  private readonly brains = new WeakMap<Hole, { gen: number; brain: BotBrain }>();
  private readonly stash: Hole[] = [];

  fly(world: World, holes: readonly Hole[]): void {
    const stash = this.stash;
    stash.length = 0;
    for (const h of world.holes) {
      if (!h.bot) continue;
      stash.push(h);
    }
    const brains = stash.map((h) => h.bot!);
    for (const h of stash) h.bot = null;
    for (const h of holes) {
      let own = this.brains.get(h);
      if (!own || own.gen !== h.gen) {
        own = { gen: h.gen, brain: world.bots.create() };
        this.brains.set(h, own);
      }
      h.bot = own.brain;
    }
    world.bots.update(world.dt);
    for (const h of holes) h.bot = null;
    stash.forEach((h, i) => (h.bot = brains[i]));
  }
}

/** A Link that only counts what the room sends. */
class CountLink implements Link {
  bytes = 0;
  snapshots = 0;
  maxSnapshot = 0;
  readonly buffered = 0;
  binary(data: Uint8Array): void {
    this.bytes += data.length;
    this.snapshots++;
    if (data.length > this.maxSnapshot) this.maxSnapshot = data.length;
  }
  json(message: ServerMessage): void {
    this.bytes += JSON.stringify(message).length;
  }
  close(): void {}
}

/** Rooms in this process, stepped as fast as they go. */
function simLoad(): void {
  const roomCount = option('rooms', 4);
  const playerCount = option('players', NET.rooms.maxPlayers);
  const seconds = option('seconds', 180);
  const bigRadius = option('radius', 0);
  const pilot = new Pilot();
  const gc = (globalThis as { gc?: () => void }).gc;
  gc?.();
  const mem = () => process.memoryUsage().heapUsed + process.memoryUsage().external;
  const heap0 = mem();
  const rooms = Array.from({ length: roomCount }, (_, i) => {
    const room = new Room(i + 1, { ...NET.rooms, seed: 1000 + i * 77 }, () => ({ rank: 1, total: 1, best: 0, personalBest: false }));
    const players = Array.from({ length: playerCount }, (_, j) => {
      const link = new CountLink();
      const player = new Player(link);
      room.join(player, `Load${i}x${j}`, j % 3 === 0 ? 2.4 : 1.4);
      return { player, link };
    });
    return { room, players, stepMs: 0, sendMs: 0, perSecond: [] as number[], counted: 0, gens: new Map<Hole, number>(), maxStep: 0, maxSend: 0, peakRadius: 0, deaths: 0 };
  });
  gc?.();
  const heapPerRoom = (mem() - heap0) / roomCount;
  const steps = seconds * 60;
  const stepsPerSnapshot = 60 / NET.snapshotRate;
  const holes: Hole[] = [];
  const t0 = performance.now();
  for (let s = 0; s < steps; s++) {
    for (const r of rooms) {
      const world = r.room.world;
      holes.length = 0;
      for (const { player } of r.players) {
        const hole = player.hole!;
        if (hole.phase === 'over' && r.room.play(player)) r.deaths++;
        if (bigRadius > 0 && hole.gen !== r.gens.get(hole)) {
          // Stress: every life starts big (spread around --radius), as in a room of veterans.
          r.gens.set(hole, hole.gen);
          hole.setRadius(bigRadius * (0.5 + (r.gens.size % 5) / 4));
        }
        holes.push(hole);
        if (hole.radius > r.peakRadius) r.peakRadius = hole.radius;
      }
      const a = performance.now();
      pilot.fly(world, holes);
      r.room.step();
      const b = performance.now();
      if (world.tick % stepsPerSnapshot === 0) r.room.broadcast();
      const c = performance.now();
      r.stepMs += b - a;
      r.sendMs += c - b;
      r.maxStep = Math.max(r.maxStep, b - a);
      r.maxSend = Math.max(r.maxSend, c - b);
      if (s % 60 === 59) {
        r.perSecond.push(r.stepMs + r.sendMs - r.counted);
        r.counted = r.stepMs + r.sendMs;
      }
    }
  }
  const wall = (performance.now() - t0) / 1000;
  console.log(`sim: ${roomCount} rooms x ${playerCount} players, ${seconds} s of play in ${fmt(wall)} s (${fmt(seconds / wall)}x real time per room set)`);
  console.log(`memory per room after creation (heap and buffers): ${fmt(heapPerRoom / 1e6)} MB; rss now ${fmt(process.memoryUsage().rss / 1e6)} MB`);
  for (const r of rooms) {
    const playerRadii = r.players.map((p) => p.player.hole!.radius);
    const botRadii = r.room.world.holes.filter((h) => h.bot).map((h) => h.radius);
    const rates = r.players.map((p) => p.link.bytes / seconds);
    const maxSnap = Math.max(...r.players.map((p) => p.link.maxSnapshot));
    const late = r.perSecond.slice(Math.floor(r.perSecond.length / 3));
    console.log(
      `room ${r.room.id}: CPU ${fmt(r.stepMs / seconds)} ms step + ${fmt(r.sendMs / seconds)} ms snapshots per second ` +
        `(${fmt(((r.stepMs + r.sendMs) / seconds / 1000) * 100, 2)} % of a core; worst second ${fmt(Math.max(...r.perSecond))} ms, ` +
        `p95 second after warm-up ${fmt(percentile(late, 0.95))} ms); worst step ${fmt(r.maxStep, 2)} ms, worst broadcast ${fmt(r.maxSend, 2)} ms`,
    );
    console.log(
      `  bytes/s per player: mean ${fmt(rates.reduce((a, b) => a + b, 0) / rates.length, 0)}, max ${fmt(Math.max(...rates), 0)}; ` +
        `biggest snapshot ${maxSnap} B; player radius now median ${fmt(percentile(playerRadii, 0.5))} max ${fmt(Math.max(...playerRadii))} ` +
        `(peak ${fmt(r.peakRadius)}); bots ${botRadii.length} max radius ${fmt(Math.max(0, ...botRadii))}; player lives ended ${r.deaths}`,
    );
  }
}

/** The server for `ws` mode, in a child process: reports its CPU, event loop delay and memory to the parent. */
async function serve(): Promise<void> {
  const fly = !args.includes('--no-pilot');
  if (fly) {
    // Fly every player's hole with the bots' brain just before each step (the clients' input is overwritten).
    const pilot = new Pilot();
    const step = Room.prototype.step;
    Room.prototype.step = function (this: Room) {
      pilot.fly(
        this.world,
        this.players.map((p) => p.hole!),
      );
      step.call(this);
    };
  }
  const maxRooms = option('max-rooms', NET.rooms.maxRooms);
  const app = await buildApp({ dbPath: ':memory:', submitPerMinute: 1e6, requestsPerMinute: 1e6, arena: { maxRooms } });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = (app.server.address() as AddressInfo).port;
  const delay = monitorEventLoopDelay({ resolution: 5 });
  delay.enable();
  let cpu = process.cpuUsage();
  let at = performance.now();
  process.on('message', (m: { t: string }) => {
    if (m.t === 'reset') {
      cpu = process.cpuUsage();
      at = performance.now();
      delay.reset();
      for (const room of app.arena.rooms) room.bytesSent = 0;
      return;
    }
    if (m.t === 'stats') {
      const used = process.cpuUsage(cpu);
      const ms = performance.now() - at;
      const rooms = app.arena.rooms;
      process.send!({
        t: 'stats',
        cpu: (used.user + used.system) / 1000 / ms,
        load: app.arena.load,
        loopP50: delay.percentile(50) / 1e6,
        loopP99: delay.percentile(99) / 1e6,
        loopMax: delay.max / 1e6,
        rss: process.memoryUsage().rss,
        heap: process.memoryUsage().heapUsed,
        rooms: rooms.map((r) => ({
          id: r.id,
          players: r.players.length,
          bytesPerSecond: r.bytesSent / (ms / 1000),
          radii: r.players.map((p) => p.hole?.radius ?? 0),
        })),
      });
      return;
    }
    if (m.t === 'stop') void app.close().then(() => process.exit(0));
  });
  process.send!({ t: 'ready', url: `ws://127.0.0.1:${port}${NET.path}` });
}

interface ServerStats {
  cpu: number;
  load: number;
  loopP50: number;
  loopP99: number;
  loopMax: number;
  rss: number;
  heap: number;
  rooms: { id: number; players: number; bytesPerSecond: number; radii: number[] }[];
}

/** A headless client: joins, sends input like the game, plays again when its life ends, counts what it gets. */
class LoadClient {
  bytes = 0;
  snapshots = 0;
  gaps: number[] = [];
  lastAt = 0;
  welcomed = false;
  closed: number | null = null;
  rtts: number[] = [];
  private readonly ws: WebSocket;
  private seq = 0;
  private readonly writer = new Writer(16);
  private timer: ReturnType<typeof setInterval> | null = null;
  private angle = Math.random() * Math.PI * 2;
  private pings = new Map<number, number>();

  constructor(url: string, index: number) {
    this.ws = new WebSocket(url, { headers: { 'x-forwarded-for': `198.51.${100 + (index >> 8)}.${index & 255}` } });
    this.ws.binaryType = 'nodebuffer';
    this.ws.on('open', () => {
      this.ws.send(JSON.stringify({ t: 'join', v: PROTOCOL_VERSION, rules: rulesHash(), name: `Load${index}`, reach: index % 3 === 0 ? 2.4 : 1.4 }));
    });
    this.ws.on('message', (data: Buffer, binary: boolean) => {
      const now = performance.now();
      this.bytes += data.length;
      if (binary) {
        if (this.lastAt) this.gaps.push(now - this.lastAt);
        this.lastAt = now;
        this.snapshots++;
        return;
      }
      const m = JSON.parse(data.toString()) as ServerMessage;
      if (m.t === 'welcome') {
        this.welcomed = true;
        this.timer = setInterval(() => this.tick(), 1000 / 30);
      } else if (m.t === 'over') {
        setTimeout(() => this.send({ t: 'play' }), 600);
      } else if (m.t === 'pong') {
        const sent = this.pings.get(m.n);
        if (sent !== undefined) this.rtts.push(now - sent);
        this.pings.delete(m.n);
      }
    });
    this.ws.on('close', (code) => {
      this.closed = code;
      if (this.timer) clearInterval(this.timer);
    });
    this.ws.on('error', () => {});
  }

  private send(m: object): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  private tick(): void {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    this.angle += (Math.random() - 0.5) * 0.3;
    this.ws.send(encodeInput(this.writer, ++this.seq, Math.cos(this.angle), Math.sin(this.angle)));
    if (this.seq % 30 === 0) {
      this.pings.set(this.seq, performance.now());
      this.send({ t: 'ping', n: this.seq });
    }
  }

  resetCounts(): void {
    this.bytes = 0;
    this.snapshots = 0;
    this.gaps = [];
    this.rtts = [];
  }

  close(): void {
    this.ws.close();
  }
}

async function wsLoad(): Promise<void> {
  const clientCount = option('clients', 48);
  const seconds = option('seconds', 60);
  let url = text('url');
  let server: ChildProcess | null = null;
  const ask = <T>(t: string): Promise<T> =>
    new Promise((resolve) => {
      server!.once('message', (m) => resolve(m as T));
      server!.send({ t });
    });
  if (!url) {
    const self = fileURLToPath(import.meta.url);
    const pass = [...(args.includes('--no-pilot') ? ['--no-pilot'] : []), '--max-rooms', String(option('max-rooms', NET.rooms.maxRooms))];
    server = fork(self, ['serve', ...pass], {
      execArgv: ['--disable-warning=ExperimentalWarning'],
    });
    url = await new Promise<string>((resolve) => server!.once('message', (m) => resolve((m as { url: string }).url)));
  }
  console.log(`ws: ${clientCount} clients against ${url}${server ? ' (local server process)' : ''} for ${seconds} s`);
  const clients: LoadClient[] = [];
  // Join a few at a time, as players would trickle in.
  for (let i = 0; i < clientCount; i++) {
    clients.push(new LoadClient(url, i));
    if (i % 4 === 3) await new Promise((r) => setTimeout(r, 100));
  }
  await new Promise((r) => setTimeout(r, 3000));
  const joined = clients.filter((c) => c.welcomed).length;
  for (const c of clients) c.resetCounts();
  if (server) server.send({ t: 'reset' });
  const samples: ServerStats[] = [];
  const t0 = performance.now();
  while (performance.now() - t0 < seconds * 1000) {
    await new Promise((r) => setTimeout(r, 10_000));
    if (server) {
      const s = await ask<ServerStats>('stats');
      samples.push(s);
      console.log(
        `  ${fmt((performance.now() - t0) / 1000, 0)} s: server CPU ${fmt(s.cpu * 100)} % of a core (rooms load ${fmt(s.load * 100)} %), loop delay p99 ${fmt(s.loopP99)} ms max ${fmt(s.loopMax)} ms, ` +
          `rss ${fmt(s.rss / 1e6)} MB, rooms ${s.rooms.map((r) => `${r.players}p`).join(' ')}`,
      );
    }
  }
  const elapsed = (performance.now() - t0) / 1000;
  const rates = clients.filter((c) => c.welcomed).map((c) => c.bytes / elapsed);
  const gaps = clients.flatMap((c) => c.gaps);
  const rtts = clients.flatMap((c) => c.rtts);
  console.log(`joined ${joined} of ${clientCount}; closed during the run: ${clients.filter((c) => c.closed !== null).map((c) => c.closed).join(', ') || 'none'}`);
  console.log(
    `received per client: mean ${fmt(rates.reduce((a, b) => a + b, 0) / Math.max(1, rates.length), 0)} B/s, max ${fmt(Math.max(0, ...rates), 0)} B/s; ` +
      `snapshot gap p50 ${fmt(percentile(gaps, 0.5))} ms, p99 ${fmt(percentile(gaps, 0.99))} ms, max ${fmt(Math.max(0, ...gaps))} ms; ` +
      `ping p50 ${fmt(percentile(rtts, 0.5))} ms, p99 ${fmt(percentile(rtts, 0.99))} ms`,
  );
  if (server) {
    const last = await ask<ServerStats>('stats');
    console.log(
      `server over the run: CPU ${fmt(last.cpu * 100)} % of a core, event loop delay p50 ${fmt(last.loopP50)} ms p99 ${fmt(last.loopP99)} ms max ${fmt(last.loopMax)} ms, ` +
        `rss ${fmt(last.rss / 1e6)} MB, heap ${fmt(last.heap / 1e6)} MB`,
    );
    for (const r of last.rooms) {
      console.log(
        `  room ${r.id}: ${r.players} players, snapshots ${fmt(r.bytesPerSecond / Math.max(1, r.players), 0)} B/s per player, ` +
          `radius median ${fmt(percentile(r.radii, 0.5))} max ${fmt(Math.max(0, ...r.radii))}`,
      );
    }
    server.send({ t: 'stop' });
  }
  for (const c of clients) c.close();
  setTimeout(() => process.exit(0), 500).unref();
}

if (mode === 'sim') simLoad();
else if (mode === 'serve') await serve();
else if (mode === 'ws') await wsLoad();
else {
  console.error(`unknown mode ${mode}: sim, ws`);
  process.exit(1);
}
