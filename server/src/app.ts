import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { LEADERBOARD, NET } from '../../src/config/index.ts';
import { checkRun, type RunSubmission } from '../../src/leaderboard/rules.ts';
import type { PostedLife } from '../../src/protocol/messages.ts';
import { Rooms, type ArenaOptions } from './arena/Rooms.ts';
import { registerArena } from './arena/socket.ts';
import { ScoreStore } from './db.ts';

export interface AppOptions {
  /** SQLite file, or ':memory:' (tests). */
  dbPath: string;
  /** Score submissions per IP per minute. */
  submitPerMinute?: number;
  /** All requests per IP per minute. */
  requestsPerMinute?: number;
  /** Room settings of the online arena (NET.rooms by default; tests make small rooms). */
  arena?: Partial<ArenaOptions>;
  logger?: boolean;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** The online arena's rooms. */
    arena: Rooms;
  }
}

/** Proxies in front of the api (Caddy, cloudflared) live on private networks; the client is the first address outside them. */
const TRUSTED_PROXIES = ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '::1', 'fc00::/7'];

/**
 * The game server. All HTTP routes live under /api (Caddy forwards the path unchanged):
 *   POST /api/scores               submit a run; returns the player's rank by their best run
 *   GET  /api/scores/top?limit=n   best run per player, highest first
 *   GET  /api/scores/rank?score=n  where a score would place (for players without a nickname)
 *   GET  /api/online               players online and rooms open
 *   GET  /api/health
 * and the online arena is a WebSocket at NET.path (/ws, see arena/socket.ts), whose rooms post the lives they score
 * to the same leaderboard.
 */
export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    // Only rejections and errors are logged; a line per request is noise on a small box.
    disableRequestLogging: true,
    trustProxy: TRUSTED_PROXIES,
    bodyLimit: 1024,
  });
  const store = new ScoreStore(options.dbPath);
  app.addHook('onClose', async () => store.close());

  await app.register(rateLimit, {
    max: options.requestsPerMinute ?? 120,
    timeWindow: '1 minute',
  });
  app.addHook('onSend', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
  });

  /** Store a run and say where the player's best run now ranks. */
  const submit = (run: RunSubmission): PostedLife & { nickname: string } => {
    const previousBest = store.best(run.nickname);
    store.add(run);
    const best = Math.max(previousBest, run.score);
    const { rank, total } = store.rank(best, run.nickname);
    return { nickname: run.nickname, rank, total, best, personalBest: run.score > previousBest };
  };

  // The online arena: lives are scored by the server and posted straight to the board (no caps: it saw them).
  await app.register(websocket, { options: { maxPayload: NET.limits.maxMessageBytes } });
  const rooms = new Rooms({ onError: (error, room) => app.log.error({ err: error, room: room.id }, 'room failed'), ...options.arena }, (run) => {
    const { rank, total, best, personalBest } = submit(run);
    return { rank, total, best, personalBest };
  });
  app.decorate('arena', rooms);
  registerArena(app, rooms);
  app.addHook('onReady', async () => rooms.start());
  app.addHook('onClose', async () => rooms.stop());

  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/online', async () => ({ players: rooms.players, rooms: rooms.rooms.length }));

  app.post(
    '/api/scores',
    { config: { rateLimit: { max: options.submitPerMinute ?? 6, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const check = checkRun(req.body);
      if (!check.ok) {
        req.log.info({ reason: check.reason }, 'score rejected');
        return reply.code(check.reason === 'invalid' ? 400 : 422).send({ error: check.reason });
      }
      return reply.code(201).send(submit(check.run));
    },
  );

  app.get('/api/scores/top', async (req) => {
    const raw = Number((req.query as { limit?: string }).limit ?? LEADERBOARD.topLimit);
    const limit = Number.isFinite(raw) ? Math.min(LEADERBOARD.topLimit, Math.max(1, Math.floor(raw))) : LEADERBOARD.topLimit;
    const entries = store.top(limit);
    return { entries, total: store.players() };
  });

  app.get('/api/scores/rank', async (req, reply) => {
    const score = Number((req.query as { score?: string }).score);
    if (!Number.isSafeInteger(score) || score < 0) return reply.code(400).send({ error: 'invalid' });
    return store.rank(score);
  });

  return app;
}
