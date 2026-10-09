import { INPUT } from '../config';
import type { InputSource, MoveVector } from './InputSource';

export type TouchMode = 'finger' | 'joystick';

/**
 * Touch (and pen) on the game canvas. Only the canvas is listened to, so DOM menus keep working.
 * 'finger': the hole drifts toward the finger, like the mouse (offset from screen centre).
 * 'joystick': a floating stick appears where the thumb lands; the drag from there steers.
 */
export class TouchInput implements InputSource {
  mode: TouchMode = 'finger';
  private pointerId = -1;
  private px = 0;
  private py = 0;
  private bx = 0;
  private by = 0;
  private readonly base = stickElement(false);
  private readonly knob = stickElement(true);

  private readonly onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' || this.pointerId !== -1) return;
    this.pointerId = e.pointerId;
    this.px = this.bx = e.clientX;
    this.py = this.by = e.clientY;
    this.updateStick();
  };
  private readonly onMove = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    this.px = e.clientX;
    this.py = e.clientY;
    this.updateStick();
  };
  private readonly onUp = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = -1;
    this.updateStick();
  };

  constructor(private readonly target: HTMLElement) {
    target.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    document.body.append(this.base, this.knob);
  }

  /** True while a finger is down on the canvas. */
  get touching(): boolean {
    return this.pointerId !== -1;
  }

  setMode(mode: TouchMode): void {
    this.mode = mode;
    this.updateStick();
  }

  /** Drop any held touch (the source was switched off or the game paused). */
  release(): void {
    this.pointerId = -1;
    this.updateStick();
  }

  read(out: MoveVector): boolean {
    if (this.pointerId === -1) return false;
    const scale = Math.min(this.target.clientWidth, this.target.clientHeight);
    if (this.mode === 'joystick') {
      const dx = (this.px - this.bx) / scale;
      const dy = -(this.py - this.by) / scale;
      return fill(out, dx, dy, INPUT.joystickRadius, INPUT.joystickDeadzone * INPUT.joystickRadius);
    }
    const dx = (this.px - this.target.clientWidth / 2) / scale;
    const dy = -(this.py - this.target.clientHeight / 2) / scale;
    return fill(out, dx, dy, INPUT.touchFullSpeedRadius, INPUT.touchDeadzone);
  }

  dispose(): void {
    this.target.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    this.base.remove();
    this.knob.remove();
  }

  private updateStick(): void {
    const on = this.pointerId !== -1 && this.mode === 'joystick';
    this.base.style.display = this.knob.style.display = on ? 'block' : 'none';
    if (!on) return;
    const scale = Math.min(this.target.clientWidth, this.target.clientHeight);
    const max = INPUT.joystickRadius * scale;
    let dx = this.px - this.bx;
    let dy = this.py - this.by;
    const len = Math.hypot(dx, dy);
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    const size = max * 2;
    place(this.base, this.bx, this.by, size);
    place(this.knob, this.bx + dx, this.by + dy, size * 0.45);
  }
}

function fill(out: MoveVector, dx: number, dy: number, fullRadius: number, deadzone: number): boolean {
  const len = Math.hypot(dx, dy);
  if (len < deadzone) return false;
  const mag = Math.min(1, len / fullRadius);
  out.x = (dx / len) * mag;
  out.y = (dy / len) * mag;
  return true;
}

function place(el: HTMLElement, cx: number, cy: number, size: number): void {
  el.style.width = el.style.height = `${size}px`;
  el.style.left = `${cx - size / 2}px`;
  el.style.top = `${cy - size / 2}px`;
}

function stickElement(knob: boolean): HTMLDivElement {
  const el = document.createElement('div');
  el.dataset.testid = knob ? 'joystick-knob' : 'joystick-base';
  Object.assign(el.style, {
    position: 'fixed',
    display: 'none',
    borderRadius: '50%',
    pointerEvents: 'none',
    zIndex: '5',
    boxSizing: 'border-box',
    border: knob ? 'none' : '2px solid rgba(160, 180, 230, 0.45)',
    background: knob ? 'rgba(200, 215, 255, 0.4)' : 'rgba(160, 180, 230, 0.08)',
  });
  return el;
}
