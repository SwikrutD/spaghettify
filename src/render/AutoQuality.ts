import { QUALITY, STORAGE } from '../config';

const AUTO = QUALITY.auto;

/**
 * Picks a rung of QUALITY.levels from measured frame times. Frames are averaged over a window; a slow
 * window steps one level down, and a long run of good windows tries one level up. A level that fails
 * within `probeTime` of a step up is not tried again this session, so the scaler cannot oscillate.
 *
 * If stepping down does not make frames faster (a 30 fps cap from a battery saver, or a CPU-bound
 * device), it undoes those steps and stops for the session rather than ruining the picture for nothing.
 * The level it settles on is remembered, so the next visit starts there instead of stuttering at first.
 * Time comes only from the frame durations it is fed, so tests can drive it.
 */
export class AutoQuality {
  /** Current index into QUALITY.levels. */
  level: number;
  /** Stopped for this session because quality did not affect the frame rate. */
  locked = false;
  /** Called after every level change. */
  onChange: ((level: number) => void) | null = null;
  private enabled = false;
  private settleLeft: number = AUTO.settle;
  private windowTime = 0;
  private windowFrames = 0;
  private goodTime = 0;
  /** Seconds left in which a slow window means the level just stepped up to is too much. */
  private probeLeft = 0;
  private readonly failed = new Set<number>();
  /** Average frame time of the window that caused the last step down, to judge whether it helped. */
  private downFromMs = 0;
  private unhelpful = 0;
  private unhelpfulFrom = 0;

  constructor(touchFirst: boolean) {
    this.level = clampLevel(touchFirst ? AUTO.startTouch : AUTO.startDesktop);
    try {
      const stored = localStorage.getItem(STORAGE.autoQuality);
      if (stored !== null && Number.isInteger(Number(stored))) this.level = clampLevel(Number(stored));
    } catch {
      // Storage blocked: start from the default.
    }
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** On while the quality setting is Auto. Turning it on starts a fresh measurement. */
  setEnabled(enabled: boolean): void {
    if (enabled && !this.enabled) this.restart();
    this.enabled = enabled;
  }

  /** Feed the real duration of one frame in milliseconds. */
  frame(ms: number): void {
    if (!this.enabled || this.locked) return;
    if (!(ms > 0) || ms > AUTO.hitchMs) {
      // A hitch or a return from a hidden tab says nothing about steady-state speed.
      this.windowTime = 0;
      this.windowFrames = 0;
      return;
    }
    if (this.settleLeft > 0) {
      this.settleLeft -= ms / 1000;
      return;
    }
    this.windowTime += ms / 1000;
    this.windowFrames++;
    if (this.windowTime < AUTO.window) return;
    const meanMs = (this.windowTime * 1000) / this.windowFrames;
    this.windowTime = 0;
    this.windowFrames = 0;
    this.decide(meanMs);
  }

  private decide(meanMs: number): void {
    if (this.downFromMs > 0) {
      const helped = meanMs < this.downFromMs * (1 - AUTO.minGain);
      this.downFromMs = 0;
      if (helped) {
        this.unhelpful = 0;
      } else if (++this.unhelpful >= AUTO.maxUnhelpful) {
        this.locked = true;
        this.setLevel(this.unhelpfulFrom);
        return;
      }
    }

    if (meanMs > AUTO.downMs) {
      if (this.probeLeft > 0) this.failed.add(this.level);
      this.probeLeft = 0;
      this.goodTime = 0;
      if (this.level >= QUALITY.levels.length - 1) return;
      if (this.unhelpful === 0) this.unhelpfulFrom = this.level;
      this.downFromMs = meanMs;
      this.setLevel(this.level + 1);
      return;
    }

    this.probeLeft = Math.max(0, this.probeLeft - AUTO.window);
    if (meanMs >= AUTO.goodMs) {
      this.goodTime = 0;
      return;
    }
    this.goodTime += AUTO.window;
    if (this.goodTime >= AUTO.upAfter && this.level > 0 && !this.failed.has(this.level - 1)) {
      this.goodTime = 0;
      this.probeLeft = AUTO.probeTime;
      this.setLevel(this.level - 1);
    }
  }

  private setLevel(level: number): void {
    this.level = level;
    this.restart();
    try {
      localStorage.setItem(STORAGE.autoQuality, String(level));
    } catch {
      // Remembering the level is a convenience.
    }
    this.onChange?.(level);
  }

  private restart(): void {
    this.settleLeft = AUTO.settle;
    this.windowTime = 0;
    this.windowFrames = 0;
  }
}

function clampLevel(level: number): number {
  return Math.min(QUALITY.levels.length - 1, Math.max(0, Math.round(level)));
}
