import type { FastifyInstance } from 'fastify';
import type { RawData, WebSocket } from 'ws';
import { NET } from '../../../src/config/index.ts';
import {
  CLOSE,
  decodeInput,
  parseClientMessage,
  PROTOCOL_VERSION,
  rulesHash,
  type InputFrame,
  type ServerMessage,
} from '../../../src/protocol/messages.ts';
import { Player, type Link } from './Player.ts';
import type { Rooms } from './Rooms.ts';

const RULES = rulesHash();
/** WebSocket readyState of an open socket. */
const OPEN = 1;

/** Per-IP connection counts: open connections and recent connection times (a sliding minute). */
class IpLimits {
  private readonly open = new Map<string, number>();
  private readonly recent = new Map<string, number[]>();

  /** True if `ip` may open another connection now (and counts the attempt). */
  admit(ip: string, now: number): boolean {
    const L = NET.limits;
    const times = (this.recent.get(ip) ?? []).filter((t) => now - t < 60_000);
    times.push(now);
    this.recent.set(ip, times);
    return times.length <= L.connectsPerMinute && (this.open.get(ip) ?? 0) < L.connectionsPerIp;
  }

  opened(ip: string): void {
    this.open.set(ip, (this.open.get(ip) ?? 0) + 1);
  }

  closed(ip: string): void {
    const n = (this.open.get(ip) ?? 1) - 1;
    if (n > 0) this.open.set(ip, n);
    else this.open.delete(ip);
  }

  /** Forget old connection times (now and then, so the map does not grow forever). */
  prune(now: number): void {
    for (const [ip, times] of this.recent) if (times.every((t) => now - t >= 60_000)) this.recent.delete(ip);
  }
}

/**
 * One client's WebSocket: parses its messages, holds it to the limits (NET.limits: a message rate with a burst,
 * strikes for dropped or malformed messages, a join deadline, pings) and passes what it asks for to the rooms.
 */
class Connection implements Link {
  readonly player: Player;
  /** Answered the last ping. */
  alive = true;
  private readonly socket: WebSocket;
  private readonly rooms: Rooms;
  private tokens: number = NET.limits.burst;
  private refilled = performance.now();
  private strikes = 0;
  private readonly joinTimer: ReturnType<typeof setTimeout>;
  private readonly frame: InputFrame = { seq: 0, x: 0, z: 0 };

  constructor(socket: WebSocket, rooms: Rooms) {
    this.socket = socket;
    this.rooms = rooms;
    this.player = new Player(this);
    this.joinTimer = setTimeout(() => {
      if (!this.player.room) this.fail('timeout');
    }, NET.limits.joinSeconds * 1000);
    socket.on('message', (data, isBinary) => this.receive(data, isBinary));
    socket.on('pong', () => {
      this.alive = true;
    });
    socket.on('close', () => {
      clearTimeout(this.joinTimer);
      this.rooms.leave(this.player);
    });
    socket.on('error', () => socket.terminate());
  }

  binary(data: Uint8Array): void {
    if (this.socket.readyState === OPEN) this.socket.send(data);
  }

  json(message: ServerMessage): void {
    if (this.socket.readyState === OPEN) this.socket.send(JSON.stringify(message));
  }

  get buffered(): number {
    return this.socket.bufferedAmount;
  }

  close(code: number, reason: string): void {
    this.socket.close(code, reason);
  }

  /** Ping the client, or drop it if it did not answer the last ping. */
  ping(): void {
    if (!this.alive) {
      this.socket.terminate();
      return;
    }
    this.alive = false;
    this.socket.ping();
  }

  /** Tell the client why and close. */
  private fail(code: keyof typeof CLOSE): void {
    this.json({ t: 'error', code });
    this.socket.close(CLOSE[code], code);
  }

  /** A dropped message; too many and the connection is closed. */
  private strike(): void {
    if (++this.strikes > NET.limits.maxStrikes) this.fail('policy');
  }

  private receive(data: RawData, isBinary: boolean): void {
    const L = NET.limits;
    const now = performance.now();
    this.tokens = Math.min(L.burst, this.tokens + ((now - this.refilled) / 1000) * L.messagesPerSecond);
    this.refilled = now;
    if (this.tokens < 1) {
      this.strike();
      return;
    }
    this.tokens -= 1;
    const bytes = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (isBinary) this.binaryMessage(bytes);
    else this.textMessage(bytes.toString('utf8'));
  }

  private binaryMessage(bytes: Uint8Array): void {
    const room = this.player.room;
    const frame = decodeInput(bytes, this.frame);
    if (!room || !frame || !room.input(this.player, frame)) this.strike();
  }

  private textMessage(text: string): void {
    const m = parseClientMessage(text);
    const player = this.player;
    if (!m) {
      this.strike();
      return;
    }
    switch (m.t) {
      case 'join': {
        if (player.room) {
          this.strike();
          return;
        }
        if (m.v !== PROTOCOL_VERSION || m.rules !== RULES) {
          this.fail('version');
          return;
        }
        const welcome = this.rooms.join(player, m.name, m.reach);
        if (!welcome) {
          this.fail('full');
          return;
        }
        clearTimeout(this.joinTimer);
        this.json(welcome);
        return;
      }
      case 'play':
        if (!player.room || !player.room.play(player)) this.strike();
        return;
      case 'view':
        if (player.room) player.room.view(player, m.reach);
        else this.strike();
        return;
      case 'ping':
        this.json({ t: 'pong', n: m.n });
        return;
    }
  }
}

/**
 * The arena's WebSocket endpoint (NET.path). Each IP may hold NET.limits.connectionsPerIp connections and open
 * connectsPerMinute a minute (behind Caddy the IP comes from X-Forwarded-For, see the app's trustProxy). A ping goes
 * out every pingSeconds; a client that missed the last one is dropped.
 */
export function registerArena(app: FastifyInstance, rooms: Rooms): void {
  const ips = new IpLimits();
  const connections = new Set<Connection>();
  app.get(
    NET.path,
    {
      websocket: true,
      preValidation: async (req, reply) => {
        if (!ips.admit(req.ip, Date.now())) await reply.code(429).send({ error: 'busy' });
      },
    },
    (socket, req) => {
      const ip = req.ip;
      ips.opened(ip);
      const connection = new Connection(socket, rooms);
      connections.add(connection);
      socket.on('close', () => {
        connections.delete(connection);
        ips.closed(ip);
      });
    },
  );
  const pinger = setInterval(() => {
    for (const c of connections) c.ping();
    ips.prune(Date.now());
  }, NET.limits.pingSeconds * 1000);
  pinger.unref();
  // On close the websocket plugin closes every connection (each leaves its room).
  app.addHook('onClose', async () => clearInterval(pinger));
}
