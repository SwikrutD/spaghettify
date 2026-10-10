import { CAMERA, COMETS, DANGER, GROWTH, HUNGER, PLAYER } from '../config/index.ts';
import type { BotBrain } from './Bots.ts';
import { Hunger, type RunPhase } from './Hunger.ts';
import { vec2 } from './vec.ts';

/** Mass of a body of the given radius. Shared by holes and prey so eating is consistent. */
export function massOfRadius(radius: number): number {
  return GROWTH.massDensity * Math.pow(radius, GROWTH.massExponent);
}

/** Radius of a body of the given mass (the inverse of massOfRadius). */
export function radiusOfMass(mass: number): number {
  return Math.pow(mass / GROWTH.massDensity, 1 / GROWTH.massExponent);
}

/** Mass of a hole of this radius, on the hole's growth curve (radius = startRadius x (mass / startMass) ^ GROWTH.radiusExponent). */
export function holeMassForRadius(radius: number): number {
  return massOfRadius(PLAYER.startRadius) * Math.pow(radius / PLAYER.startRadius, 1 / GROWTH.radiusExponent);
}

/**
 * How far out a hole of this radius sees: the camera distance that frames it (the view pulls back slower than the
 * hole grows, so it gets bigger on screen). Gameplay is measured in it too (top speed, comet paths, what counts as
 * near a hole), always from the radius alone, never from a client's screen shape.
 */
export function viewDistance(radius: number): number {
  return CAMERA.startDistance * Math.pow(radius / PLAYER.startRadius, CAMERA.zoomExponent);
}

/** A hole's top speed at a radius: it follows the view distance, so the speed on screen holds as it grows. */
export function topSpeed(radius: number): number {
  return PLAYER.maxSpeed * Math.pow(viewDistance(radius) / CAMERA.startDistance, PLAYER.speedExponent);
}

/**
 * How quickly a hole's velocity chases its input (1/s). Bigger holes are heavier: they turn and accelerate more
 * slowly (PLAYER.agilityExponent of the view distance), so a smaller hole can dodge one that is faster in a straight line.
 */
export function responsiveness(radius: number): number {
  return PLAYER.responsiveness * Math.pow(viewDistance(radius) / CAMERA.startDistance, -PLAYER.agilityExponent);
}

/** Something a hole ate, as the score screen names it ("You ate a moon"). */
export interface Meal {
  name: string;
  radius: number;
  /** True for a whole hole (name is its nickname). */
  hole?: boolean;
}

/**
 * A black hole on the play plane, driven by `input`; nothing here knows where the input comes from (a player or,
 * later, a bot). `radius` is the gameplay radius: it chases the radius implied by `mass` so growth is smooth.
 */
export class Hole {
  readonly id: number;
  /** Nickname shown over the hole (a player's own or a generated one). */
  name = '';
  /** Counts lives (every reset), so the renderer can tell a respawned hole from the one it drew. */
  gen = 0;
  /** The bot's character and plan, or null for a hole steered from outside (the local player, a remote player). */
  bot: BotBrain | null = null;
  readonly position = vec2();
  readonly velocity = vec2();
  /** Desired movement on the play plane, length 0..1. Screen up is -z for the local player. */
  readonly input = vec2();
  /** External acceleration (gravity pull from big bodies and the arena edge), set each step by Dangers. */
  readonly pull = vec2();
  radius: number = PLAYER.startRadius;
  mass = massOfRadius(PLAYER.startRadius);
  /** Mass at the start of a life. A hit never takes the hole below it. */
  readonly startMass = this.mass;
  /** Highest mass of this life: the score. */
  peakMass = this.mass;
  /** Mass eaten this life. Shed debris eaten back does not count. */
  eatenMass = 0;
  /** Meals this life (specks swallowed on the way do not count). */
  eatenCount = 0;
  biggestEaten: Meal | null = null;
  /** Seconds left of a hit's stun: input is ignored and the knockback carries the hole. */
  stun = 0;
  /** Seconds of invulnerability left after a hit. */
  invulnerable = 0;
  /** Hits taken and mass shed this life. */
  hits = 0;
  shedMass = 0;
  /** Highest size milestone index reached this life (it only goes up). */
  milestone = 0;
  /** Seconds left of a hit's fast shrink: meanwhile the radius drops to the shed mass at DANGER.shrinkRate. */
  shrink = 0;
  /** Seconds until this hole draws its next comet. */
  cometTimer: number = COMETS.firstDelay;
  /** Seconds left of spawn protection: no hole can eat it, bump it or be eaten by it. */
  protection = 0;
  /** Holes swallowed this life. */
  holesEaten = 0;
  /** While being eaten (and after): who ate this hole, and where it was from the eater at that moment. */
  eatenBy = -1;
  eatenByName = '';
  readonly eatOffset = vec2();
  /** 0..1 progress of being swallowed (the renderer draws the spaghettification from it). */
  eatProgress = 0;
  prevEat = 0;
  /** Seconds until a bot whose life is over comes back (the world counts it down). */
  respawnIn = 0;
  readonly hunger: Hunger;
  /** Position and radius at the start of the last step: the renderer interpolates from them. */
  prevX = 0;
  prevZ = 0;
  prevRadius: number = PLAYER.startRadius;

  constructor(id: number) {
    this.id = id;
    this.hunger = new Hunger(this);
  }

  get phase(): RunPhase {
    return this.hunger.phase;
  }

  /** True once the hole is being swallowed or its life is over: it is no longer part of the arena's rules. */
  get absent(): boolean {
    return this.hunger.phase === 'over' || this.hunger.phase === 'eaten';
  }

  /** Only a hole in play eats: not while it evaporates or after. */
  get canEat(): boolean {
    return this.hunger.phase === 'playing';
  }

  /** Points for this life: the peak mass gained over the start. */
  get score(): number {
    return Math.round((this.peakMass - this.startMass) * HUNGER.pointsPerMass);
  }

  /** Continuous mass-to-radius curve. */
  radiusForMass(): number {
    return PLAYER.startRadius * Math.pow(this.mass / this.startMass, GROWTH.radiusExponent);
  }

  /** Steering, drift and the radius for `dt` seconds. Input only steers while the hole is in play and not stunned. */
  move(dt: number): void {
    if (this.hunger.phase === 'eaten') {
      this.velocity.x = this.velocity.z = 0;
      return;
    }
    const maxSpeed = topSpeed(this.radius);
    const stunned = this.stun > 0;
    this.stun = Math.max(0, this.stun - dt);
    const steer = !stunned && this.hunger.phase === 'playing';
    const tx = steer ? this.input.x * maxSpeed : 0;
    const tz = steer ? this.input.z * maxSpeed : 0;
    const v = this.velocity;
    const k = 1 - Math.exp(-(stunned ? DANGER.stunResponsiveness : responsiveness(this.radius)) * dt);
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
   * mass comes back but it is not counted as eaten and never the biggest meal, so bump farming gains nothing.
   */
  eat(preyMass: number, what: Meal | null, reclaimed: boolean): number {
    if (!reclaimed && what && (!this.biggestEaten || what.radius > this.biggestEaten.radius)) this.biggestEaten = what;
    const gained = this.gain(preyMass);
    if (!reclaimed) this.eatenMass += gained;
    this.eatenCount++;
    return gained;
  }

  /** Swallow matter on the way (a speck): it adds mass but is not a meal. Returns the mass gained. */
  absorb(preyMass: number): number {
    const gained = this.gain(preyMass);
    this.eatenMass += gained;
    return gained;
  }

  private gain(preyMass: number): number {
    const gained = preyMass * GROWTH.absorbEfficiency;
    this.mass += gained;
    if (this.mass > this.peakMass) this.peakMass = this.mass;
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

  /** Start the life at a bigger size: this radius, its mass on the hole curve. */
  setRadius(radius: number): void {
    this.mass = this.peakMass = holeMassForRadius(radius);
    this.radius = radius;
    this.capture();
  }

  /** A fresh life at (x, z). */
  reset(x = 0, z = 0): void {
    this.gen++;
    this.mass = this.peakMass = this.startMass;
    this.radius = PLAYER.startRadius;
    this.protection = 0;
    this.holesEaten = 0;
    this.eatenBy = -1;
    this.eatenByName = '';
    this.eatOffset.x = this.eatOffset.z = 0;
    this.eatProgress = 0;
    this.respawnIn = 0;
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
    this.milestone = 0;
    this.shrink = 0;
    this.cometTimer = COMETS.firstDelay;
    this.hunger.reset();
    this.capture();
  }

  /** Remember the position and radius at the start of a step (render interpolation). */
  capture(): void {
    this.prevX = this.position.x;
    this.prevZ = this.position.z;
    this.prevRadius = this.radius;
    this.prevEat = this.eatProgress;
  }
}
