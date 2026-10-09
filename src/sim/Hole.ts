import { DANGER, GROWTH, PLAYER, TIERS } from '../config/index.ts';
import { Hunger, type RunPhase } from './Hunger.ts';
import { vec2 } from './vec.ts';
import { View } from './View.ts';

/** Mass of a body of the given radius. Shared by holes and prey so eating is consistent. */
export function massOfRadius(radius: number): number {
  return GROWTH.massDensity * Math.pow(radius, GROWTH.massExponent);
}

/** Radius of a body of the given mass (the inverse of massOfRadius). */
export function radiusOfMass(mass: number): number {
  return Math.pow(mass / GROWTH.massDensity, 1 / GROWTH.massExponent);
}

/** A hole's top speed at a view scale (its view distance over the starting distance): constant on screen. */
export function topSpeed(viewScale: number): number {
  return PLAYER.maxSpeed * Math.pow(viewScale, PLAYER.speedExponent);
}

/** Something a hole ate, as the score screen names it ("You ate a moon"). */
export interface Meal {
  name: string;
  radius: number;
}

/**
 * A black hole on the play plane. The local player is one, driven by `input`; nothing here knows where the
 * input comes from. `radius` is the gameplay radius: it chases the radius implied by `mass` so growth is smooth.
 */
export class Hole {
  readonly id: number;
  readonly position = vec2();
  readonly velocity = vec2();
  /** Desired movement on the play plane, length 0..1. Screen up is -z for the local player. */
  readonly input = vec2();
  /** External acceleration (gravity pull from big bodies), set each step by Dangers. */
  readonly pull = vec2();
  radius: number = PLAYER.startRadius;
  mass = massOfRadius(PLAYER.startRadius);
  /** Mass at the start of a life. A hit never takes the hole below it. */
  readonly startMass = this.mass;
  /** Mass eaten this life (score). Shed debris eaten back does not count. */
  eatenMass = 0;
  eatenCount = 0;
  biggestEaten: Meal | null = null;
  /** Seconds left of a hit's stun: input is ignored and the knockback carries the hole. */
  stun = 0;
  /** Seconds of invulnerability left after a hit. */
  invulnerable = 0;
  /** Hits taken and mass shed this life. */
  hits = 0;
  shedMass = 0;
  /** Highest tier index reached this life (it only goes up). */
  tier = 0;
  /** Seconds left of a hit's fast shrink: meanwhile the radius drops to the shed mass at DANGER.shrinkRate. */
  shrink = 0;
  readonly view: View;
  readonly hunger: Hunger;
  /** Position and radius at the start of the last step: the renderer interpolates from them. */
  prevX = 0;
  prevZ = 0;
  prevRadius: number = PLAYER.startRadius;

  constructor(id: number) {
    this.id = id;
    this.view = new View(this.radius, TIERS[0].cameraScale);
    this.hunger = new Hunger(this);
  }

  get phase(): RunPhase {
    return this.hunger.phase;
  }

  /** Only a hole in play eats: not while it evaporates or after. */
  get canEat(): boolean {
    return this.hunger.phase === 'playing';
  }

  /** Continuous mass-to-radius curve. */
  radiusForMass(): number {
    return PLAYER.startRadius * Math.pow(this.mass / this.startMass, GROWTH.radiusExponent);
  }

  /** Steering, drift and the radius for `dt` game seconds. Input only steers while the hole is in play and not stunned. */
  move(dt: number): void {
    const maxSpeed = topSpeed(this.view.viewScale);
    const stunned = this.stun > 0;
    this.stun = Math.max(0, this.stun - dt);
    const steer = !stunned && this.hunger.phase === 'playing';
    const tx = steer ? this.input.x * maxSpeed : 0;
    const tz = steer ? this.input.z * maxSpeed : 0;
    const v = this.velocity;
    const k = 1 - Math.exp(-(stunned ? DANGER.stunResponsiveness : PLAYER.responsiveness) * dt);
    v.x += (tx - v.x) * k;
    v.z += (tz - v.z) * k;
    v.x += this.pull.x * dt;
    v.z += this.pull.z * dt;
    const drag = Math.exp(-PLAYER.drag * dt);
    v.x *= drag;
    v.z *= drag;
    this.position.x += v.x * dt;
    this.position.z += v.z * dt;

    const target = this.radiusForMass();
    this.shrink = Math.max(0, this.shrink - dt);
    const rate = this.shrink > 0 && target < this.radius ? DANGER.shrinkRate : GROWTH.radiusSmoothing;
    this.radius += (target - this.radius) * (1 - Math.exp(-rate * dt));
  }

  /**
   * Absorb a meal of the given mass; returns the mass gained. `reclaimed` is the hole's own shed debris: the
   * mass comes back but it is not score (eatenMass) and never the biggest meal, so bump farming gains nothing.
   */
  eat(preyMass: number, what: Meal | null, reclaimed: boolean): number {
    if (!reclaimed && what && (!this.biggestEaten || what.radius > this.biggestEaten.radius)) this.biggestEaten = what;
    const gained = preyMass * GROWTH.absorbEfficiency;
    this.mass += gained;
    if (!reclaimed) this.eatenMass += gained;
    this.eatenCount++;
    return gained;
  }

  /** Lose mass to a hit, never below the start mass, and start the fast shrink. Returns the mass lost. */
  shed(fraction: number): number {
    const target = Math.max(this.mass * (1 - fraction), Math.min(this.mass, this.startMass));
    const lost = this.mass - target;
    this.mass = target;
    this.shrink = DANGER.squashTime;
    return lost;
  }

  /** A fresh life at (x, z). */
  reset(x = 0, z = 0): void {
    this.mass = this.startMass;
    this.radius = PLAYER.startRadius;
    this.eatenMass = 0;
    this.eatenCount = 0;
    this.biggestEaten = null;
    this.position.x = x;
    this.position.z = z;
    this.velocity.x = this.velocity.z = 0;
    this.input.x = this.input.z = 0;
    this.pull.x = this.pull.z = 0;
    this.stun = 0;
    this.invulnerable = 0;
    this.hits = 0;
    this.shedMass = 0;
    this.tier = 0;
    this.shrink = 0;
    this.view.reset(this.radius, TIERS[0].cameraScale);
    this.hunger.reset();
    this.capture();
  }

  /** Remember the position and radius at the start of a step (render interpolation). */
  capture(): void {
    this.prevX = this.position.x;
    this.prevZ = this.position.z;
    this.prevRadius = this.radius;
  }
}
