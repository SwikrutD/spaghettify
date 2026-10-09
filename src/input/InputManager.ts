import type { InputSource, MoveVector } from './InputSource';

/**
 * The single input abstraction. Game logic only reads `move`; it never touches a device.
 * Sources are polled in priority order and the first active one wins.
 */
export class InputManager {
  readonly move: MoveVector = { x: 0, y: 0 };

  constructor(private readonly sources: InputSource[]) {}

  update(): void {
    this.move.x = 0;
    this.move.y = 0;
    for (const s of this.sources) {
      if (s.read(this.move)) return;
    }
  }

  dispose(): void {
    for (const s of this.sources) s.dispose();
  }
}
