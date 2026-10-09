import { PREY, SPAGHETTI, type PreyColor } from '../config/index.ts';
import type { Rng } from './rng.ts';
import { vec2, type Vec2 } from './vec.ts';

export type BodyState = 'alive' | 'eating';

/** One pooled body: a prey object, a comet nucleus or a debris fragment. Pools never grow or shrink; entries are reused. */
export interface Body {
  readonly position: Vec2;
  readonly velocity: Vec2;
  radius: number;
  mass: number;
  /** Player-facing class name, e.g. "asteroid" (what "You ate X" names). */
  className: string;
  /** Drawn as a smooth sphere (planets, moons) instead of a lumpy rock. */
  round: boolean;
  state: BodyState;
  /** 0..1 scale-in after (re)spawning. */
  appear: number;
  /** 0..1 progress of the infall after being eaten. */
  eatProgress: number;
  /** Infall duration in seconds (bigger bodies fall in more slowly). */
  infallTime: number;
  /** Offset from the eating hole at the moment it was eaten. The infall follows the hole if it moves. */
  readonly eatOffset: Vec2;
  /** Size weight (0..1) fixed when eaten: scales the infall time and the stretch and curl of the stream. */
  infallWeight: number;
  /** Id of the hole it is falling into while eating, -1 otherwise. */
  eaterId: number;
  /** Look: colour ranges, and a seed per spawn that the renderer derives the colour and spin from. */
  color: PreyColor;
  seed: number;
  /** Counts (re)spawns, so the renderer can tell when a reused slot holds a new body. */
  gen: number;
  /** Position and infall progress at the start of the last step: the renderer interpolates from them. */
  prevX: number;
  prevZ: number;
  prevEat: number;
}

export function createBody(color: PreyColor): Body {
  return {
    position: vec2(),
    velocity: vec2(),
    radius: 1,
    mass: 1,
    className: '',
    round: false,
    state: 'alive',
    appear: 1,
    eatProgress: 0,
    infallTime: 1,
    eatOffset: vec2(),
    infallWeight: 0,
    eaterId: -1,
    color,
    seed: 0,
    gen: 0,
    prevX: 0,
    prevZ: 0,
    prevEat: 0,
  };
}

/** A pool slot holds a new body: fresh look, alive, and no interpolation from wherever the slot was before. Call after placing it. */
export function spawned(obj: Body, rng: Rng): void {
  obj.state = 'alive';
  obj.eatProgress = 0;
  obj.eaterId = -1;
  obj.seed = rng.uint();
  obj.gen++;
  capture(obj);
}

/** Remember where the body is at the start of a step (render interpolation). */
export function capture(obj: Body): void {
  obj.prevX = obj.position.x;
  obj.prevZ = obj.position.z;
  obj.prevEat = obj.eatProgress;
}

/** True if a hole of this radius can eat an object of the given radius. */
export function canSwallow(objRadius: number, holeRadius: number): boolean {
  return objRadius < holeRadius * PREY.edibleRatio;
}

/** 0..1: how big an edible object is for the hole. Bigger prey spaghettify harder and fall in more slowly. */
export function sizeWeight(objRadius: number, holeRadius: number): number {
  return Math.min(1, objRadius / (holeRadius * PREY.edibleRatio)) ** SPAGHETTI.sizePower;
}
