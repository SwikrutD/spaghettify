import type { InputSource, MoveVector } from './InputSource';

/**
 * The single input abstraction. Game logic only reads `move`; it never touches a device.
 * Sources are polled in priority order and the first active one wins. A source can be switched off
 * by id (the control scheme setting), and the whole manager can be paused (menus).
 */
export class InputManager {
  readonly move: MoveVector = { x: 0, y: 0 };
  private readonly disabled = new Set<string>();

  constructor(private readonly sources: { id: string; source: InputSource }[]) {}

  setEnabled(id: string, enabled: boolean): void {
    if (enabled) this.disabled.delete(id);
    else this.disabled.add(id);
  }

  update(): void {
    this.move.x = 0;
    this.move.y = 0;
    for (const { id, source } of this.sources) {
      if (this.disabled.has(id)) continue;
      if (source.read(this.move)) return;
    }
  }

  dispose(): void {
    for (const { source } of this.sources) source.dispose();
  }
}
