import { HUNGER, NET } from '../../../src/config/index.ts';
import { cleanNickname, isProfane, type RunSubmission } from '../../../src/leaderboard/rules.ts';
import {
  clampReach,
  CLOSE,
  PROTOCOL_VERSION,
  type InputFrame,
  type OverMessage,
  type PostedLife,
  type WelcomeMessage,
} from '../../../src/protocol/messages.ts';
import { Writer } from '../../../src/protocol/wire.ts';
import type { DiedEvent } from '../../../src/sim/events.ts';
import type { Hole } from '../../../src/sim/Hole.ts';
import { generateName } from '../../../src/sim/names.ts';
import { World } from '../../../src/sim/World.ts';
import { Interest } from './Interest.ts';
import type { Player } from './Player.ts';

export interface RoomOptions {
  /** Holes the room aims for (bots fill the rest), players it takes at most, and bots it always keeps. */
  population: number;
  maxPlayers: number;
  minBots: number;
  seed: number;
}

/** Posts a life the server scored to the global leaderboard; null if it was not stored. */
export type LifePoster = (run: RunSubmission) => PostedLife | null;

/** A hole's points on the live board: the mass it has grown by over its start (as the HUD shows them). */
function livePoints(hole: Hole): number {
  return Math.round(Math.max(0, hole.mass - hole.startMass) * HUNGER.pointsPerMass);
}

/**
 * One online arena: a src/sim World run exactly as the offline game runs it (fixed SIM.tickRate steps, bots, hole vs
 * hole), with no hole of its own: every player's hole comes from addHole and is steered only by that player's input.
 * Bots fill the room to its population and step aside as players join (World.botTarget). Every
 * SIM.tickRate / NET.snapshotRate steps each player gets a snapshot of what is near it; once a second the live top
 * 10. The server scores every player's life itself and posts it to the leaderboard when the player has a nickname.
 */
export class Room {
  readonly id: number;
  readonly world: World;
  readonly players: Player[] = [];
  readonly options: RoomOptions;
  /** World time the room last became empty (or was made); the manager closes rooms empty for long. */
  emptySince = 0;
  /** Bytes of snapshots sent since the room was made (load measurements). */
  bytesSent = 0;
  snapshotsSent = 0;
  private readonly post: LifePoster;
  private readonly byHole = new Map<number, Player>();
  private readonly writer = new Writer(16 * 1024);
  private readonly stepsPerSnapshot: number;
  /** Steps per second, and the steps run since `epoch` (ms on the manager's clock). */
  private readonly rate: number;
  private epoch = 0;
  private steps = 0;
  private eventsSeen = 0;
  private boardIn = 0;

  constructor(id: number, options: RoomOptions, post: LifePoster, now = 0) {
    this.id = id;
    this.options = options;
    this.post = post;
    this.world = new World({ seed: options.seed, bots: options.population, local: false });
    this.world.field.trackChanges = true;
    this.rate = Math.round(1 / this.world.dt);
    this.stepsPerSnapshot = Math.max(1, Math.round(this.rate / NET.snapshotRate));
    this.epoch = now;
    this.updateBots();
  }

  get full(): boolean {
    return this.players.length >= this.options.maxPlayers;
  }

  /** The player this hole belongs to, if any. */
  playerOf(hole: Hole): Player | undefined {
    return this.byHole.get(hole.id);
  }

  /**
   * A player joins: a new hole at a clear spawn point (protected for a moment), named by the player's nickname if
   * the filter lets it through, else a generated name (and its lives are not posted). A bot steps aside.
   */
  join(player: Player, nickname: string | undefined, reach: number | undefined): WelcomeMessage {
    const world = this.world;
    const clean = cleanNickname(nickname ?? '');
    const refused = clean !== '' && isProfane(clean);
    const named = clean !== '' && !refused;
    const hole = world.addHole();
    hole.name = named ? clean : generateName(world.rng, (n) => world.holes.some((h) => h !== hole && h.name === n));
    world.respawn(hole);
    player.room = this;
    player.hole = hole;
    player.named = named;
    player.reach = clampReach(reach);
    player.interest = new Interest(world);
    player.interest.reach = player.reach;
    player.lastSeq = player.ack = 0;
    player.overAt = -1;
    player.scored = false;
    player.pendingOver = null;
    this.players.push(player);
    this.byHole.set(hole.id, player);
    this.updateBots();
    return {
      t: 'welcome',
      v: PROTOCOL_VERSION,
      room: this.id,
      hole: hole.id,
      name: hole.name,
      named,
      refused,
      seed: world.seed,
      tick: world.tick,
      tickRate: this.rate,
      snapshotRate: NET.snapshotRate,
    };
  }

  /** A player leaves: a life still going is scored (and posted) as it stands, and its hole leaves the arena. A bot comes back. */
  leave(player: Player): void {
    const hole = player.hole;
    if (!hole || player.room !== this) return;
    if (!player.scored) this.score(player, null);
    this.world.removeHole(hole);
    const i = this.players.indexOf(player);
    if (i >= 0) this.players.splice(i, 1);
    this.byHole.delete(hole.id);
    player.room = null;
    player.hole = null;
    player.interest = null;
    if (this.players.length === 0) this.emptySince = this.world.time;
    this.updateBots();
  }

  /** Play again: a new life in the running arena, once the last one is over. False if it is not over (or only just). */
  play(player: Player): boolean {
    const hole = player.hole;
    if (!hole || player.room !== this || hole.phase !== 'over') return false;
    if (this.world.time - player.overAt < NET.limits.playAgainDelay) return false;
    this.world.respawn(hole);
    player.overAt = -1;
    player.scored = false;
    player.pendingOver = null;
    return true;
  }

  /** The player's movement input; it steers from the next step on. False for an old or repeated one. */
  input(player: Player, frame: InputFrame): boolean {
    const hole = player.hole;
    if (!hole || frame.seq <= player.lastSeq) return false;
    player.lastSeq = frame.seq;
    hole.input.x = frame.x;
    hole.input.z = frame.z;
    return true;
  }

  /** The screen reach changed. */
  view(player: Player, reach: number): void {
    player.reach = clampReach(reach);
    if (player.interest) player.interest.reach = player.reach;
  }

  /** Run the steps that are due at `now` (ms on the manager's clock), sending snapshots on schedule. A stall drops steps past NET.maxCatchUpSteps. */
  advance(now: number): void {
    let due = Math.floor(((now - this.epoch) * this.rate) / 1000) - this.steps;
    if (due > NET.maxCatchUpSteps) {
      this.epoch = now;
      this.steps = -NET.maxCatchUpSteps;
      due = NET.maxCatchUpSteps;
    }
    for (let i = 0; i < due; i++) {
      this.steps++;
      this.step();
      if (this.world.tick % this.stepsPerSnapshot === 0) this.broadcast();
    }
  }

  /** One world step. The players' latest inputs steer it; a player's life that ends is scored at once. */
  step(): void {
    const world = this.world;
    world.step();
    for (const p of this.players) p.ack = p.lastSeq;
    const events = world.events;
    for (let i = this.eventsSeen; i < events.length; i++) {
      const e = events[i];
      if (e.type !== 'died') continue;
      const player = this.byHole.get(e.hole);
      if (!player || player.scored) continue;
      player.overAt = world.time;
      player.pendingOver = this.score(player, e);
    }
    this.eventsSeen = events.length;
  }

  /**
   * Snapshots to every player (one that has fallen behind reading them skips this one, one far behind is let go),
   * then any life that ended, and the board when it is due. The world's events and field changes are then cleared.
   */
  broadcast(): void {
    const world = this.world;
    const L = NET.limits;
    let drop: Player[] | null = null;
    for (const p of this.players) {
      const link = p.link;
      if (link.buffered > L.maxBufferedBytes) {
        (drop ??= []).push(p);
        continue;
      }
      if (link.buffered > L.skipBytes) {
        p.interest!.missed();
      } else {
        this.writer.reset();
        p.interest!.write(this.writer, world, p.hole!, p.ack, world.events);
        link.binary(this.writer.bytes());
        this.bytesSent += this.writer.length;
        this.snapshotsSent++;
      }
      if (p.pendingOver) {
        link.json(p.pendingOver);
        p.pendingOver = null;
      }
      if (p.overAt >= 0 && world.time - p.overAt > L.idleDeadSeconds) (drop ??= []).push(p);
    }
    world.clearEvents();
    world.field.clearChanges();
    this.eventsSeen = 0;
    this.boardIn -= this.stepsPerSnapshot * world.dt;
    if (this.boardIn <= 0) {
      this.boardIn += NET.boardInterval;
      this.sendBoard();
    }
    if (drop) {
      for (const p of drop) {
        const idle = p.overAt >= 0 && world.time - p.overAt > L.idleDeadSeconds;
        p.link.json({ t: 'error', code: idle ? 'idle' : 'slow' });
        p.link.close(idle ? CLOSE.idle : CLOSE.slow, idle ? 'idle' : 'slow');
      }
    }
  }

  /** The live top 10 by mass (bots included: they are not marked) and each player's own place. */
  private sendBoard(): void {
    const holes = this.world.holes.filter((h) => !h.absent).sort((a, b) => b.mass - a.mass);
    const rows: [number, string, number][] = holes.slice(0, NET.boardRows).map((h) => [h.id, h.name, livePoints(h)]);
    for (const p of this.players) {
      const rank = p.hole ? holes.indexOf(p.hole) : -1;
      p.link.json({
        t: 'board',
        rows,
        you: rank >= 0 ? [rank + 1, livePoints(p.hole!)] : null,
        holes: holes.length,
        players: this.players.length,
      });
    }
  }

  /**
   * Score a player's life as the server saw it: the peak mass over the start (Hole.score), the milestone, the time
   * and the meals. Posted to the leaderboard under the player's nickname (bots and players without one never are).
   * `died` is the end of the life (null when the player left mid-life: posted, nothing to tell).
   */
  private score(player: Player, died: DiedEvent | null): OverMessage | null {
    const hole = player.hole!;
    player.scored = true;
    const run: RunSubmission = {
      nickname: hole.name,
      score: hole.score,
      tier: hole.milestone + 1,
      seconds: Math.round(hole.hunger.runTime * 10) / 10,
      eaten: hole.eatenCount,
    };
    let posted: PostedLife | null = null;
    if (player.named && run.score >= NET.minPostScore) {
      try {
        posted = this.post(run);
      } catch {
        posted = null;
      }
    }
    if (!died) return null;
    return {
      t: 'over',
      gen: hole.gen,
      cause: died.cause,
      by: died.by,
      byName: died.byName,
      score: run.score,
      peakMass: hole.peakMass,
      milestone: run.tier,
      seconds: run.seconds,
      eaten: run.eaten,
      holesEaten: hole.holesEaten,
      biggest: hole.biggestEaten,
      posted,
    };
  }

  private updateBots(): void {
    this.world.botTarget = Math.max(this.options.minBots, this.options.population - this.players.length);
  }
}
