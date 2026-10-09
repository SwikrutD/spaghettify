import { INPUT } from '../config';
import type { InputSource, MoveVector } from './InputSource';

/** First connected gamepad: left stick moves (screen up is stick up), D-pad as a fallback. */
export class GamepadInput implements InputSource {
  read(out: MoveVector): boolean {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return false;
    for (const pad of navigator.getGamepads()) {
      if (!pad || !pad.connected) continue;
      let x = pad.axes[0] ?? 0;
      let y = -(pad.axes[1] ?? 0);
      const dpadX = (pad.buttons[15]?.pressed ? 1 : 0) - (pad.buttons[14]?.pressed ? 1 : 0);
      const dpadY = (pad.buttons[12]?.pressed ? 1 : 0) - (pad.buttons[13]?.pressed ? 1 : 0);
      if (dpadX !== 0 || dpadY !== 0) {
        x = dpadX;
        y = dpadY;
      }
      const len = Math.hypot(x, y);
      if (len < INPUT.gamepadDeadzone) continue;
      // Rescale so the speed ramps from zero at the deadzone edge to full at the rim.
      const mag = Math.min(1, (len - INPUT.gamepadDeadzone) / (1 - INPUT.gamepadDeadzone));
      out.x = (x / len) * mag;
      out.y = (y / len) * mag;
      return true;
    }
    return false;
  }

  dispose(): void {}
}
