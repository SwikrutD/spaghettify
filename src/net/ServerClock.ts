import { NET_CLIENT } from '../config/index.ts';

/**
 * The server's step clock as the client sees it: which tick the newest snapshot would carry right now, if it came
 * with the least delay seen lately. Each snapshot's arrival gives a lag (local time in ticks minus its tick); the
 * smallest lag over the last few seconds is the delivery without queueing, so late snapshots do not pull the clock
 * back. The clock eases toward a new estimate (no jumps in what is drawn) unless it is far off (a stall, a hidden
 * tab). Pure: the caller passes the time.
 */
export class ServerClock {
  /** Ticks per second (the server's step rate). */
  readonly rate: number;
  private readonly lags: Float64Array;
  private filled = 0;
  private next = 0;
  /** Applied offset (ticks) and the one it eases toward: tick(now) = now * rate + offset. */
  private offset = 0;
  private target = 0;
  private started = false;

  constructor(rate: number) {
    this.rate = rate;
    this.lags = new Float64Array(NET_CLIENT.clockWindow);
  }

  /** A snapshot of `tick` arrived at `nowMs`. */
  sample(tick: number, nowMs: number): void {
    this.lags[this.next] = (nowMs / 1000) * this.rate - tick;
    this.next = (this.next + 1) % this.lags.length;
    this.filled = Math.min(this.lags.length, this.filled + 1);
    let min = Infinity;
    for (let i = 0; i < this.filled; i++) if (this.lags[i] < min) min = this.lags[i];
    this.target = -min;
    if (!this.started) {
      this.started = true;
      this.offset = this.target;
    }
  }

  /** Ease the applied clock toward the estimate for `dt` real seconds. */
  update(dt: number): void {
    const diff = this.target - this.offset;
    const max = NET_CLIENT.clockSlew * dt * this.rate;
    if (Math.abs(diff) > NET_CLIENT.clockJumpSteps || Math.abs(diff) <= max) this.offset = this.target;
    else this.offset += Math.sign(diff) * max;
  }

  /** The server tick now (fractional). */
  tick(nowMs: number): number {
    return (nowMs / 1000) * this.rate + this.offset;
  }
}
