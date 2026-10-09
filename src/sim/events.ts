import type { Meal } from './Hole.ts';

/** A hole ate something. `biggest`: it is the hole's biggest meal of this life so far. */
export interface AteEvent {
  type: 'ate';
  hole: number;
  /** Mass of what was eaten, and the mass the hole gained from it. */
  mass: number;
  gained: number;
  /** The hole's mass and radius right after the meal. */
  holeMass: number;
  holeRadius: number;
  what: Meal | null;
  /** The hole's own shed debris: mass back, no score. */
  reclaimed: boolean;
  biggest: boolean;
}

/** A damaging contact: the hole was knocked back along (nx, nz) from (x, z), where it was of radius `radius`. */
export interface BumpedEvent {
  type: 'bumped';
  hole: number;
  x: number;
  z: number;
  radius: number;
  nx: number;
  nz: number;
  by: 'body' | 'comet';
}

/** A hole lost mass to a hit (zero at the start mass); the shed matter flies off as debris. */
export interface ShedEvent {
  type: 'shed';
  hole: number;
  mass: number;
}

/** A hole reached a new size tier (index into TIERS). */
export interface TierEvent {
  type: 'tier';
  hole: number;
  index: number;
}

/** A hole's life ended (it finished evaporating). */
export interface DiedEvent {
  type: 'died';
  hole: number;
}

/** What render, audio, UI and juice react to. The world queues these as it steps; the client drains them each frame. */
export type SimEvent = AteEvent | BumpedEvent | ShedEvent | TierEvent | DiedEvent;
