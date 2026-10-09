import type { InputSource, MoveVector } from './InputSource';

/** WASD or arrow keys. */
export class KeyboardInput implements InputSource {
  private readonly down = new Set<string>();
  private readonly onDown = (e: KeyboardEvent) => {
    this.down.add(e.code);
  };
  private readonly onUp = (e: KeyboardEvent) => {
    this.down.delete(e.code);
  };
  private readonly onBlur = () => {
    this.down.clear();
  };

  constructor() {
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
    window.addEventListener('blur', this.onBlur);
  }

  read(out: MoveVector): boolean {
    const d = this.down;
    const x = (d.has('KeyD') || d.has('ArrowRight') ? 1 : 0) - (d.has('KeyA') || d.has('ArrowLeft') ? 1 : 0);
    const y = (d.has('KeyW') || d.has('ArrowUp') ? 1 : 0) - (d.has('KeyS') || d.has('ArrowDown') ? 1 : 0);
    if (x === 0 && y === 0) return false;
    const len = Math.hypot(x, y);
    out.x = x / len;
    out.y = y / len;
    return true;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    window.removeEventListener('blur', this.onBlur);
  }
}
