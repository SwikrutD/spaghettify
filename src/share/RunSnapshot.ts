import { SHARE } from '../config';

/**
 * Screenshot of the run for the share card. The WebGL canvas has no preserveDrawingBuffer, so the copy is
 * taken right after a render, in the same task, into a small 2D canvas. Main asks for a photo when the run
 * sets a new biggest meal (taken a moment later, while it spaghettifies) and once more as a fallback when
 * the hole starts to evaporate if nothing was photographed yet.
 */
export class RunSnapshot {
  /** The latest photo, or null before the first one of the run. */
  image: HTMLCanvasElement | null = null;
  /** Photos taken this run (debug and tests). */
  taken = 0;
  private readonly buffer = document.createElement('canvas');
  /** Real seconds since the run started. */
  private clock = 0;
  /** Clock time the pending photo is due, or -1. */
  private due = -1;
  private lastTaken = -Infinity;

  /** Photograph the scene `delay` real seconds from now (no sooner than the minimum interval). */
  request(delay: number = SHARE.snapshotDelay): void {
    const at = Math.max(this.clock + delay, this.lastTaken + SHARE.snapshotMinInterval);
    // A photo already on its way covers this request: it lands during the same infall.
    if (this.due < 0) this.due = at;
  }

  /** Photograph the next frame unless the run already has a photo. */
  ensure(): void {
    if (!this.image && this.due < 0) this.due = this.clock;
  }

  update(realDt: number): void {
    this.clock += realDt;
  }

  /** Call right after the renderer drew a frame into `canvas`. */
  afterRender(canvas: HTMLCanvasElement): void {
    if (this.due < 0 || this.clock < this.due) return;
    this.due = -1;
    this.lastTaken = this.clock;
    const scale = Math.min(1, SHARE.snapshotMaxSize / Math.max(canvas.width, canvas.height, 1));
    const w = Math.max(1, Math.round(canvas.width * scale));
    const h = Math.max(1, Math.round(canvas.height * scale));
    if (this.buffer.width !== w || this.buffer.height !== h) {
      this.buffer.width = w;
      this.buffer.height = h;
    }
    const ctx = this.buffer.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(canvas, 0, 0, w, h);
    this.image = this.buffer;
    this.taken++;
  }

  reset(): void {
    this.image = null;
    this.taken = 0;
    this.clock = 0;
    this.due = -1;
    this.lastTaken = -Infinity;
  }
}
