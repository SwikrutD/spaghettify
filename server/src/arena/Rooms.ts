import { randomInt } from 'node:crypto';
import { NET } from '../../../src/config/index.ts';
import { CLOSE, type WelcomeMessage } from '../../../src/protocol/messages.ts';
import type { Player } from './Player.ts';
import { Room, type LifePoster } from './Room.ts';

export interface ArenaOptions {
  /** Holes a room aims for, players a room takes, bots a room always keeps (see NET.rooms). */
  population: number;
  maxPlayers: number;
  minBots: number;
  /** Rooms the server runs at most, and seconds a room may stay empty before it closes. */
  maxRooms: number;
  emptySeconds: number;
  /** World seed for a new room (random by default). */
  seed: () => number;
  /** The clock rooms run on, in milliseconds (performance.now by default). */
  now: () => number;
  /** Told when a room fails (it is closed and its players let go; the other rooms run on). */
  onError: (error: unknown, room: Room) => void;
}

/**
 * Every room on the server and quick play: a player joins the fullest room that has space, or a new one while the
 * server has room for it. One timer advances every room to real time; rooms nobody has been in for a while close.
 */
export class Rooms {
  readonly rooms: Room[] = [];
  readonly options: ArenaOptions;
  private readonly post: LifePoster;
  private nextId = 1;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: Partial<ArenaOptions>, post: LifePoster) {
    this.options = {
      ...NET.rooms,
      seed: () => randomInt(1, 2 ** 31),
      now: () => performance.now(),
      onError: (error) => console.error(error),
      ...options,
    };
    this.post = post;
  }

  /** Players in every room. */
  get players(): number {
    let n = 0;
    for (const room of this.rooms) n += room.players.length;
    return n;
  }

  /** The room quick play sends a new player to: the fullest with space (the oldest of equals), else a new one; null when full. */
  quickPlay(): Room | null {
    let best: Room | null = null;
    for (const room of this.rooms) {
      if (!room.full && (!best || room.players.length > best.players.length)) best = room;
    }
    if (best) return best;
    if (this.rooms.length >= this.options.maxRooms) return null;
    const o = this.options;
    const room = new Room(this.nextId++, { population: o.population, maxPlayers: o.maxPlayers, minBots: o.minBots, seed: o.seed() >>> 0 }, this.post, o.now());
    this.rooms.push(room);
    return room;
  }

  /** Quick play: into the fullest room with space. Null when every room is full and no new one can open. */
  join(player: Player, nickname: string | undefined, reach: number | undefined): WelcomeMessage | null {
    if (player.room) return null;
    const room = this.quickPlay();
    return room ? room.join(player, nickname, reach) : null;
  }

  leave(player: Player): void {
    player.room?.leave(player);
  }

  /** Advance every room to now; close the rooms that have been empty for NET.rooms.emptySeconds, and any that fails. */
  tick(): void {
    const now = this.options.now();
    for (let i = this.rooms.length - 1; i >= 0; i--) {
      const room = this.rooms[i];
      try {
        room.advance(now);
      } catch (error) {
        // A broken world is not touched again: its players are let go as they are (their lives are not posted).
        this.rooms.splice(i, 1);
        this.options.onError(error, room);
        for (const p of room.players.splice(0)) {
          p.room = null;
          p.hole = null;
          p.interest = null;
          p.link.json({ t: 'error', code: 'error' });
          p.link.close(CLOSE.error, 'error');
        }
        continue;
      }
      if (room.players.length === 0 && room.world.time - room.emptySince >= this.options.emptySeconds) this.rooms.splice(i, 1);
    }
  }

  /** Run the rooms on a timer (a few times per step, so steps stay evenly spaced). */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 5);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
