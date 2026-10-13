import { NET_CLIENT } from '../config/index.ts';
import type { BoardMessage, ClientMessage, OverMessage, ServerMessage, WelcomeMessage } from '../protocol/messages.ts';
import type { Snapshot } from '../protocol/snapshot.ts';
import type { Hole } from '../sim/Hole.ts';
import type { World } from '../sim/World.ts';
import { ArenaMirror } from './ArenaMirror.ts';
import { Prediction } from './Prediction.ts';
import { ServerClock } from './ServerClock.ts';

/** Where the arena's messages go: the socket (or a test's simulated link). */
export interface ServerLink {
  sendBinary(bytes: Uint8Array): void;
  send(message: ClientMessage): void;
}

/** What the server sent, as the client reads it: snapshots decoded, control messages parsed. */
export type Incoming = Snapshot | ServerMessage;

function isSnapshot(m: Incoming): m is Snapshot {
  // Control messages are typed by `t`; snapshots have none.
  return (m as ServerMessage).t === undefined;
}

/**
 * One online life in a server room, from the client's side: the mirror of the arena (ArenaMirror), the prediction of
 * the own hole (Prediction) and the server clock the other holes are drawn by (ServerClock). The game calls `receive`
 * as messages come and `update` once a frame; it draws `world` like the offline one, the own hole at its predicted
 * place plus `drawOffset`. Pure: no sockets, DOM or clock of its own, so a test can run it against a real room.
 */
export class OnlineArena {
  readonly welcome: WelcomeMessage;
  readonly mirror: ArenaMirror;
  readonly prediction: Prediction;
  readonly clock: ServerClock;
  /** Seconds per step (the server's). */
  readonly dt: number;
  /** How far the drawing is past the last predicted step (0..1). */
  alpha = 1;
  /** The latest live board, and the last life's account from the server. */
  board: BoardMessage | null = null;
  over: OverMessage | null = null;
  onBoard: ((board: BoardMessage) => void) | null = null;
  /** The server scored the life that just ended (it posted it, when it could). */
  onOver: ((over: OverMessage) => void) | null = null;
  /** A new life of the own hole started (after Play again): the game starts drawing it afresh. */
  onNewLife: (() => void) | null = null;
  private readonly link: ServerLink;
  private readonly queue: Incoming[] = [];
  private latest: Snapshot | null = null;
  private started = false;
  private pending = 0;
  /** Real seconds since the session began, when the life ended (-1: it has not) and when Play again last went out. */
  private time = 0;
  private overAt = -1;
  private wantPlay = false;
  private playSent = -Infinity;
  private reach = 0;

  constructor(welcome: WelcomeMessage, link: ServerLink, reach = 0) {
    this.welcome = welcome;
    this.link = link;
    this.reach = reach;
    this.dt = 1 / welcome.tickRate;
    this.mirror = new ArenaMirror(welcome.seed, welcome.hole, welcome.name);
    this.prediction = new Prediction(this.mirror.local, welcome.tick, this.mirror.world.dangers);
    this.clock = new ServerClock(welcome.tickRate);
  }

  get world(): World {
    return this.mirror.world;
  }

  /** The own hole. */
  get local(): Hole {
    return this.mirror.local;
  }

  /** True once the first snapshot placed the own hole. */
  get ready(): boolean {
    return this.started;
  }

  /** Where the own hole is drawn relative to its predicted place (a correction fading out). */
  get drawOffset(): { x: number; z: number } {
    return this.prediction.offset;
  }

  /** A message from the server, at `nowMs` (any clock in milliseconds, the same one `update` gets). */
  receive(message: Incoming, nowMs: number): void {
    if (isSnapshot(message)) this.clock.sample(message.tick, nowMs);
    this.queue.push(message);
    // A tab that draws no frames still gets snapshots: keep the backlog short, applying the oldest without their effects.
    while (this.queue.length > NET_CLIENT.maxQueued) this.handle(this.queue.shift()!, false);
  }

  /**
   * Once a frame: take in what came, put the own hole back where the server had it and replay, then run the steps
   * due (sending the input `steerX`, `steerZ` on the play plane as they go) and draw the other holes in the past.
   */
  update(realDt: number, steerX: number, steerZ: number, nowMs: number): void {
    this.time += realDt;
    this.clock.update(realDt);
    for (const m of this.queue.splice(0)) this.handle(m, true);
    const latest = this.latest;
    if (latest) {
      this.latest = null;
      this.ownState(latest);
    }
    if (!this.started) return;
    const local = this.local;

    this.pending += Math.min(realDt, NET_CLIENT.maxFrameSeconds);
    let first = true;
    while (this.pending >= this.dt) {
      this.prediction.input(steerX, steerZ, first, (bytes) => this.link.sendBinary(bytes));
      first = false;
      this.prediction.step(this.dt);
      this.mirror.advance(this.dt);
      if (local.phase === 'playing') local.hunger.runTime += this.dt;
      this.pending -= this.dt;
    }
    this.alpha = this.pending / this.dt;
    this.prediction.decay(realDt);
    const own = this.mirror.ownDrawn;
    own.x = local.position.x + this.prediction.offset.x;
    own.z = local.position.z + this.prediction.offset.z;
    const rate = this.clock.rate;
    this.mirror.interpolate(this.clock.tick(nowMs) - NET_CLIENT.interpDelay * rate, NET_CLIENT.maxExtrapolate * rate);

    if (this.wantPlay && local.phase === 'over' && this.overAt >= 0) {
      const since = this.time - this.overAt;
      if (since >= NET_CLIENT.playAgainDelay && this.time - this.playSent >= NET_CLIENT.playAgainRetry) {
        this.playSent = this.time;
        this.link.send({ t: 'play' });
      }
    }
  }

  /** Play again once the server will take it (and again now and then until the new life shows up). */
  playAgain(): void {
    this.wantPlay = true;
  }

  /** True while Play again waits for the new life. */
  get awaitingLife(): boolean {
    return this.wantPlay;
  }

  /** Stop steering the own hole now (the tab is being hidden: no frames will send input for a while). */
  halt(): void {
    this.prediction.halt((bytes) => this.link.sendBinary(bytes));
  }

  /** The screen's reach changed (view distances): the server sizes what it sends by it. */
  setReach(reach: number): void {
    if (Math.abs(reach - this.reach) < 0.05) return;
    this.reach = reach;
    this.link.send({ t: 'view', reach });
  }

  private handle(m: Incoming, effects: boolean): void {
    if (isSnapshot(m)) {
      this.mirror.apply(m, effects);
      this.prediction.observe(m.tick, m.ack);
      this.latest = m;
      return;
    }
    switch (m.t) {
      case 'board':
        this.board = m;
        this.onBoard?.(m);
        return;
      case 'over':
        this.over = m;
        if (this.overAt < 0) this.overAt = this.time;
        this.onOver?.(m);
        return;
    }
  }

  /** The snapshot's own hole: a new life, the moment it starts being swallowed, then the prediction catches up. */
  private ownState(s: Snapshot): void {
    const you = s.you;
    const local = this.local;
    const prediction = this.prediction;
    const fresh = !this.started || you.gen !== local.gen;
    if (fresh) {
      local.reset(you.x, you.z);
      local.gen = you.gen;
      prediction.newLife();
      this.overAt = -1;
      this.wantPlay = false;
      this.playSent = -Infinity;
      this.over = null;
    }
    // Swallowed: the hole falls in from where it is drawn, toward the eater as drawn here (not from the server's moment).
    const swallowed = you.phase === 'eaten' && local.phase !== 'eaten';
    const drawn = this.mirror.ownDrawn;
    const eater = swallowed ? this.mirror.drawnAt(you.eatenBy) : null;
    const offsetX = eater ? drawn.x - eater.x : you.eatOffsetX;
    const offsetZ = eater ? drawn.z - eater.z : you.eatOffsetZ;
    prediction.reconcile(s.tick, you, this.dt);
    if (swallowed) {
      local.eatenBy = you.eatenBy;
      local.eatOffset.x = offsetX;
      local.eatOffset.z = offsetZ;
    }
    // A hole being swallowed is drawn from its eater: no correction of its own.
    if (you.phase === 'eaten') prediction.snap();
    if (you.phase === 'over' && this.overAt < 0) this.overAt = this.time;
    if (fresh) {
      prediction.snap();
      local.capture();
      this.started = true;
      this.onNewLife?.();
    }
  }
}
