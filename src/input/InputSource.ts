/** Normalised movement request. x right, y up on screen. Length is 0..1. */
export interface MoveVector {
  x: number;
  y: number;
}

export interface InputSource {
  /** Write the desired movement into `out`. Return false if this source is idle. */
  read(out: MoveVector): boolean;
  dispose(): void;
}
