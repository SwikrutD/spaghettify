// The online protocol, shared by the server (server/src/arena) and the game: what each side sends. Rare control
// messages are JSON text frames; the client's input and the server's snapshots are binary frames (see snapshot.ts).
// Pure and erasable TypeScript (the server runs it with Node's type stripping).
import {
  ARENA,
  BODIES,
  BOTS,
  CAMERA,
  COMETS,
  DANGER,
  DEBRIS,
  FIELD,
  GROWTH,
  HOLES,
  HUNGER,
  MILESTONES,
  NET,
  PLAYER,
  PREY,
  SIM,
  SPAGHETTI,
} from '../config/index.ts';
import type { Meal } from '../sim/Hole.ts';
import { Reader, Writer } from './wire.ts';

/** Bumped whenever a message changes shape. The server turns away a client of another version. */
export const PROTOCOL_VERSION = 1;

/** First byte of a binary frame. */
export const BINARY = {
  /** Client to server: the movement input (see encodeInput). */
  input: 1,
  /** Server to client: a snapshot (see snapshot.ts). */
  snapshot: 2,
} as const;

/** WebSocket close codes the server uses (4000 to 4999 are free for applications). */
export const CLOSE = {
  /** Every room is full. */
  full: 4001,
  /** Another protocol version or other game rules (a stale page after a deploy: reload). */
  version: 4002,
  /** Too many messages, malformed ones, or too many connections. */
  policy: 4003,
  /** The life ended long ago and Play again never came. */
  idle: 4004,
  /** No join in time. */
  timeout: 4005,
  /** Fell too far behind reading snapshots. */
  slow: 4006,
  /** The server is shutting down. */
  shutdown: 4007,
  /** The room failed (a server bug); the other rooms run on. */
  error: 4008,
} as const;

/** Client to server: join quick play. `name` is the nickname (empty for a generated one), `reach` see NET.interest. */
export interface JoinMessage {
  t: 'join';
  v: number;
  /** rulesHash() of the client's build: both sides must run the same rules to share an arena. */
  rules: number;
  name?: string;
  reach?: number;
}

/** Client to server: start a new life after the last one ended. */
export interface PlayMessage {
  t: 'play';
}

/** Client to server: the screen's reach changed (resize, rotation). */
export interface ViewMessage {
  t: 'view';
  reach: number;
}

/** Client to server: echoed straight back as a pong (round trip time). */
export interface PingMessage {
  t: 'ping';
  n: number;
}

export type ClientMessage = JoinMessage | PlayMessage | ViewMessage | PingMessage;

/** Server to client, once after a join: which room, which hole is yours, and what the arena is built from. */
export interface WelcomeMessage {
  t: 'welcome';
  v: number;
  room: number;
  /** Id of your hole (it stays the same over every life in this room). */
  hole: number;
  /** The name you play under: your nickname as cleaned, or a generated one. */
  name: string;
  /** True if the name is your own nickname (lives are posted to the global leaderboard under it). */
  named: boolean;
  /** True if the nickname you sent was refused by the filter (you play under a generated name). */
  refused: boolean;
  /** World seed: the procedural field is built from it, like the server's. */
  seed: number;
  /** World step count now (snapshots carry it too) and the rates. */
  tick: number;
  tickRate: number;
  snapshotRate: number;
}

/** Server to client, every NET.boardInterval: the arena's live top 10 by mass (bots included) and your place. */
export interface BoardMessage {
  t: 'board';
  /** [hole id, name, points], best first. */
  rows: [number, string, number][];
  /** Your place (1-based) and points, or null while your life is over. */
  you: [number, number] | null;
  /** Holes in play and players in the room. */
  holes: number;
  players: number;
}

/** What the server did with a life it posted to the global leaderboard (as POST /api/scores answers). */
export interface PostedLife {
  rank: number;
  total: number;
  best: number;
  personalBest: boolean;
}

/** Server to client: your life ended. The server scored it (and posted it if you play under your nickname). */
export interface OverMessage {
  t: 'over';
  /** The life (hole.gen) this was. */
  gen: number;
  cause: 'eaten' | 'evaporated';
  /** Who ate you (-1 and '' when you evaporated). */
  by: number;
  byName: string;
  /** Points: the peak mass of the life over the start mass (see Hole.score). */
  score: number;
  peakMass: number;
  /** Highest milestone reached, 1-based. */
  milestone: number;
  seconds: number;
  /** Meals and holes eaten. */
  eaten: number;
  holesEaten: number;
  biggest: Meal | null;
  /** Leaderboard result, or null when not posted (no nickname, or too few points). */
  posted: PostedLife | null;
}

export interface PongMessage {
  t: 'pong';
  n: number;
}

/** Server to client before it closes the connection (the close code says the same). */
export interface ErrorMessage {
  t: 'error';
  code: keyof typeof CLOSE;
}

export type ServerMessage = WelcomeMessage | BoardMessage | OverMessage | PongMessage | ErrorMessage;

/**
 * Client to server binary input: seq u32 (counting up from 1), then the movement on the play plane (x, z) as i16 of
 * -1..1 (length at most 1). The newest one steers from the next step on and snapshots ack its seq. Send it when it
 * changes or about 30 times a second, not every frame: NET.limits.messagesPerSecond counts every message.
 */
export function encodeInput(w: Writer, seq: number, x: number, z: number): Uint8Array {
  w.reset();
  w.u8(BINARY.input);
  w.u32(seq);
  w.i16(Math.round(Math.max(-1, Math.min(1, x)) * 32767));
  w.i16(Math.round(Math.max(-1, Math.min(1, z)) * 32767));
  return w.bytes();
}

export interface InputFrame {
  seq: number;
  x: number;
  z: number;
}

/** Decode an input frame into `out` (length clamped to 1); null if it is not one. */
export function decodeInput(bytes: Uint8Array, out: InputFrame): InputFrame | null {
  if (bytes.length !== 9 || bytes[0] !== BINARY.input) return null;
  const r = new Reader(bytes);
  r.u8();
  out.seq = r.u32();
  let x = r.i16() / 32767;
  let z = r.i16() / 32767;
  const len = Math.hypot(x, z);
  if (len > 1) {
    x /= len;
    z /= len;
  }
  out.x = x;
  out.z = z;
  return out;
}

/** Parse a client's JSON text frame; null if it is not a well-formed message. */
export function parseClientMessage(text: string): ClientMessage | null {
  let m: unknown;
  try {
    m = JSON.parse(text);
  } catch {
    return null;
  }
  if (!m || typeof m !== 'object') return null;
  const o = m as Record<string, unknown>;
  switch (o.t) {
    case 'join':
      if (typeof o.v !== 'number' || typeof o.rules !== 'number') return null;
      if (o.name !== undefined && typeof o.name !== 'string') return null;
      if (o.reach !== undefined && !isFiniteNumber(o.reach)) return null;
      return { t: 'join', v: o.v, rules: o.rules, name: o.name as string | undefined, reach: o.reach as number | undefined };
    case 'play':
      return { t: 'play' };
    case 'view':
      return isFiniteNumber(o.reach) ? { t: 'view', reach: o.reach } : null;
    case 'ping':
      return isFiniteNumber(o.n) ? { t: 'ping', n: o.n } : null;
    default:
      return null;
  }
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Interest reach (view distances) the server uses for a reach a client asked for. */
export function clampReach(reach: number | undefined): number {
  const I = NET.interest;
  if (reach === undefined || !Number.isFinite(reach)) return I.reachMax;
  return Math.min(I.reachMax, Math.max(I.reachMin, reach));
}

/**
 * A fingerprint of every rule the shared simulation runs on. The client draws the procedural field from the seed
 * and predicts its own hole with these numbers, so a client built with other ones (a page cached from before a
 * deploy) cannot share an arena: the server turns it away and it reloads.
 */
export function rulesHash(): number {
  const rules = { PROTOCOL_VERSION, SIM, PLAYER, GROWTH, HUNGER, PREY, DANGER, COMETS, DEBRIS, SPAGHETTI, CAMERA, ARENA, FIELD, BODIES, MILESTONES, HOLES, BOTS };
  const text = JSON.stringify(rules);
  // FNV-1a.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
