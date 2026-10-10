import { HOLES, NET_CLIENT } from '../config/index.ts';
import { decodeInput, encodeInput, type InputFrame } from '../protocol/messages.ts';
import type { NetYou } from '../protocol/snapshot.ts';
import { Writer } from '../protocol/wire.ts';
import { clampToArena, edgePush } from '../sim/arena.ts';
import { responsiveness, topSpeed, viewDistance, type Hole } from '../sim/Hole.ts';
import { vec2 } from '../sim/vec.ts';

/** Steps of input history kept (a power of two, well over NET_CLIENT.maxReplaySteps). */
const RING = 256;
const MASK = RING - 1;

/**
 * Client-side prediction of the own hole. The hole runs the same 60 Hz Hole.move as the server, steered by the
 * input as it was sent (each message holds until the next, as on the server) and pulled by what the server last
 * said pulls it (the gas wall worked out here, where the hole is). Every snapshot puts the hole back where the
 * server had it and replays the steps predicted since then; whatever moved is a correction, faded out over
 * NET_CLIENT.correctionTime (a big one snaps).
 *
 * Which steps to replay: input message s went out before predicted step p(s), and the server first used it in its
 * step S(s) (a snapshot of tick T acks it once S(s) <= T). With a steady link p(s) - S(s) is a constant, the `lead`,
 * so the server's tick T is predicted step T + lead and the steps after it are the ones to replay. Each snapshot
 * bounds the lead from both sides (its ack was used by T, the next message was not), and the lead follows those
 * bounds with some patience for jitter (NET_CLIENT.leadStreak) and at once for a big change (a stall).
 */
export class Prediction {
  readonly hole: Hole;
  /** Tick of the predicted state (the client's own count of steps). */
  tick: number;
  /** Predicted step p is the server's step p - lead; null until the first input is acked. */
  lead: number | null = null;
  /** Correction still to fade out: the hole is drawn at its predicted place plus this. */
  readonly offset = vec2();
  /** Steps the last snapshot replayed (about the round trip), its correction (world units), corrections made and snapped (tests and tuning). */
  replayed = 0;
  lastError = 0;
  corrections = 0;
  snaps = 0;
  /** Input messages sent. */
  seq = 0;
  private readonly inputs = new Float32Array(RING * 2);
  private readonly sentSeq = new Float64Array(RING);
  private readonly sentStep = new Float64Array(RING);
  private heldX = 0;
  private heldZ = 0;
  private lastSend = -Infinity;
  private streak = 0;
  private streakDir = 0;
  /** What pulls the hole apart from the gas wall, as of the last snapshot. */
  private readonly bodyPull = vec2();
  private readonly edge = vec2();
  private readonly writer = new Writer(16);
  private readonly frame: InputFrame = { seq: 0, x: 0, z: 0 };

  constructor(hole: Hole, tick: number) {
    this.hole = hole;
    this.tick = tick;
  }

  /**
   * Before the next predicted step: send the input (x, z on the play plane) if one is due, at most once a frame
   * (`canSend`) and only while the hole is in play, then note what the step steers with.
   */
  input(x: number, z: number, canSend: boolean, send: (bytes: Uint8Array) => void): void {
    const q = this.tick + 1;
    if (canSend && this.hole.phase === 'playing' && q - this.lastSend >= NET_CLIENT.inputSteps) {
      const bytes = encodeInput(this.writer, ++this.seq, x, z);
      // Steer with exactly what the server will decode.
      decodeInput(bytes, this.frame);
      this.heldX = this.frame.x;
      this.heldZ = this.frame.z;
      const i = this.seq & MASK;
      this.sentSeq[i] = this.seq;
      this.sentStep[i] = q;
      this.lastSend = q;
      send(bytes);
    }
    this.inputs[(q & MASK) * 2] = this.heldX;
    this.inputs[(q & MASK) * 2 + 1] = this.heldZ;
  }

  /**
   * Stop steering right away, between frames (the tab is being hidden and draws no more frames: the server would
   * otherwise steer the hole by the last input until it comes back).
   */
  halt(send: (bytes: Uint8Array) => void): void {
    if (this.hole.phase !== 'playing') return;
    const q = this.tick + 1;
    const bytes = encodeInput(this.writer, ++this.seq, 0, 0);
    const i = this.seq & MASK;
    this.sentSeq[i] = this.seq;
    this.sentStep[i] = q;
    this.lastSend = q;
    this.heldX = this.heldZ = 0;
    send(bytes);
  }

  /** One predicted step of `dt` seconds. */
  step(dt: number): void {
    this.tick++;
    this.advance(this.tick, dt);
  }

  /** Fade the correction for `dt` real seconds. */
  decay(dt: number): void {
    const k = Math.exp(-dt / NET_CLIENT.correctionTime);
    this.offset.x *= k;
    this.offset.z *= k;
  }

  /** A snapshot of `tick` acked input `ack`: check the lead against what the server had and had not used by then. */
  observe(tick: number, ack: number): void {
    const used = this.stepOf(ack);
    const unused = this.stepOf(ack + 1);
    // The lead is at least p(ack) - tick (used by then) and at most p(ack + 1) - tick - 1 (not used yet).
    const lo = used === null ? -Infinity : used - tick;
    const hi = unused === null ? Infinity : unused - tick - 1;
    if (lo === -Infinity && hi === Infinity) return;
    if (this.lead === null) {
      this.lead = lo > -Infinity ? lo : hi;
      return;
    }
    let want = this.lead;
    if (lo > want) want = lo;
    else if (hi < want) want = hi;
    const diff = want - this.lead;
    if (diff === 0) {
      this.streak = 0;
      return;
    }
    if (Math.abs(diff) >= NET_CLIENT.leadJump) {
      this.lead = want;
      this.streak = 0;
      return;
    }
    const dir = Math.sign(diff);
    this.streak = this.streakDir === dir ? this.streak + 1 : 1;
    this.streakDir = dir;
    if (this.streak >= NET_CLIENT.leadStreak) {
      this.lead += dir;
      this.streak = 0;
    }
  }

  /**
   * The server's state of the hole at `tick`: take it, replay the steps predicted since, and keep what moved as a
   * correction to fade out (or snap, past NET_CLIENT.snapViews view distances). Returns the steps replayed.
   */
  reconcile(tick: number, you: NetYou, dt: number): number {
    const h = this.hole;
    const beforeX = h.position.x;
    const beforeZ = h.position.z;
    h.position.x = you.x;
    h.position.z = you.z;
    h.velocity.x = you.vx;
    h.velocity.z = you.vz;
    h.radius = you.radius;
    h.mass = you.mass;
    if (you.mass > h.peakMass) h.peakMass = you.mass;
    h.eatenMass = you.eatenMass;
    h.hunger.level = you.hunger;
    h.hunger.phase = you.phase;
    h.stun = you.stun;
    h.invulnerable = you.invulnerable;
    h.protection = you.protection;
    h.shrink = you.shrink;
    h.eatProgress = you.eatProgress;
    // The server's pull includes the gas wall where it had the hole; the wall is worked out afresh at every replayed step.
    edgePush(you.x, you.z, you.radius, responsiveness(you.radius) * topSpeed(you.radius), this.edge);
    this.bodyPull.x = you.pullX - this.edge.x;
    this.bodyPull.z = you.pullZ - this.edge.z;

    const count = this.lead === null ? 0 : Math.max(0, Math.min(NET_CLIENT.maxReplaySteps, this.tick - tick - this.lead));
    h.capture();
    for (let q = this.tick - count + 1; q <= this.tick; q++) this.advance(q, dt);
    this.replayed = count;

    const ex = beforeX - h.position.x;
    const ez = beforeZ - h.position.z;
    this.lastError = Math.hypot(ex, ez);
    this.corrections++;
    if (this.lastError > NET_CLIENT.snapViews * viewDistance(h.radius)) {
      this.snaps++;
      this.snap();
    } else {
      this.offset.x += ex;
      this.offset.z += ez;
    }
    return count;
  }

  /** Drop the correction (a teleport, a new life, the start of a swallow). */
  snap(): void {
    this.offset.x = this.offset.z = 0;
  }

  /** A new life: no correction, and no input held over from the last one (the server starts it still). */
  newLife(): void {
    this.snap();
    this.heldX = this.heldZ = 0;
    this.inputs.fill(0);
    this.lastSend = -Infinity;
  }

  /** Predicted step that input message `seq` went out before, or null if it is not known (any more). */
  private stepOf(seq: number): number | null {
    if (seq <= 0 || seq > this.seq) return null;
    const i = seq & MASK;
    return this.sentSeq[i] === seq ? this.sentStep[i] : null;
  }

  /** Step q of the hole, as the server steps a hole: timers, pull (the wall where it is), Hole.move, the hard edge. */
  private advance(q: number, dt: number): void {
    const h = this.hole;
    h.capture();
    h.input.x = this.inputs[(q & MASK) * 2];
    h.input.z = this.inputs[(q & MASK) * 2 + 1];
    if (h.protection > 0) h.protection = Math.max(0, h.protection - dt);
    h.invulnerable = Math.max(0, h.invulnerable - dt);
    if (h.phase === 'eaten') h.eatProgress = Math.min(1, h.eatProgress + dt / HOLES.infallTime);
    edgePush(h.position.x, h.position.z, h.radius, responsiveness(h.radius) * topSpeed(h.radius), this.edge);
    h.pull.x = this.bodyPull.x + this.edge.x;
    h.pull.z = this.bodyPull.z + this.edge.z;
    h.move(dt);
    clampToArena(h);
  }
}
