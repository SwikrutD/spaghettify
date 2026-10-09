import { INPUT } from '../config';
import type { InputSource, MoveVector } from './InputSource';

/** Mouse follow: the hole drifts toward the pointer, faster the further away it is. */
export class MouseInput implements InputSource {
  private px = 0;
  private py = 0;
  private active = false;
  private readonly onMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    this.px = e.clientX;
    this.py = e.clientY;
    this.active = true;
  };
  private readonly onLeave = () => {
    this.active = false;
  };

  constructor(private readonly target: HTMLElement) {
    window.addEventListener('pointermove', this.onMove);
    document.addEventListener('pointerleave', this.onLeave);
  }

  read(out: MoveVector): boolean {
    if (!this.active) return false;
    const w = this.target.clientWidth;
    const h = this.target.clientHeight;
    const scale = Math.min(w, h);
    const dx = (this.px - w / 2) / scale;
    const dy = -(this.py - h / 2) / scale;
    const len = Math.hypot(dx, dy);
    if (len < INPUT.mouseDeadzone) return false;
    const mag = Math.min(1, len / INPUT.mouseFullSpeedRadius);
    out.x = (dx / len) * mag;
    out.y = (dy / len) * mag;
    return true;
  }

  dispose(): void {
    window.removeEventListener('pointermove', this.onMove);
    document.removeEventListener('pointerleave', this.onLeave);
  }
}
