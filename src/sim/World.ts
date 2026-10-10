import { ARENA, DANGER, PREY, SIM, SPAGHETTI } from '../config/index.ts';
import { canSwallow, sizeWeight, type Body } from './body.ts';
import { CometField } from './CometField.ts';
import { Dangers } from './Dangers.ts';
import { DebrisField } from './DebrisField.ts';
import type { SimEvent } from './events.ts';
import { Hole, viewDistance, type Meal } from './Hole.ts';
import { lerp } from './math.ts';
import { MatterField } from './MatterField.ts';
import { milestoneIndexForMass } from './milestones.ts';
import { PreyField } from './PreyField.ts';
import { Rng } from './rng.ts';

export interface WorldOptions {
  /** Seed of the world's random stream and of the procedural field. The same seed and inputs give the same world. */
  seed?: number;
  /** Fixed steps per second (SIM.tickRate by default). */
  tickRate?: number;
}

/**
 * The whole game state and its rules, stepped at a fixed rate: one bounded arena (ARENA) where every size of
 * matter coexists (the procedural `field` of small matter, the individual `prey` bodies, comets and debris) and
 * the holes in it, each driven by its input vector. Pure and deterministic: no three.js, DOM or browser APIs, and
 * every random choice comes from `rng`, so the server can run it too. Renderers, audio and UI only read its state
 * and drain `events`. No rule follows one particular hole: `focus` is only the local player's hole for the client.
 */
export class World {
  /** Seconds per step. */
  readonly dt: number;
  readonly seed: number;
  readonly rng: Rng;
  readonly holes: Hole[] = [];
  /** The local player's hole (the first one). Nothing in the rules depends on it. */
  readonly focus: Hole;
  readonly field: MatterField;
  readonly prey: PreyField;
  readonly comets: CometField;
  readonly debris: DebrisField;
  readonly dangers: Dangers;
  /** What happened since the last clearEvents(), oldest first. */
  readonly events: SimEvent[] = [];
  /** Steps and seconds since the world was made or reset. */
  tick = 0;
  time = 0;
  private nextId = 0;

  constructor(options: WorldOptions = {}) {
    this.dt = 1 / (options.tickRate ?? SIM.tickRate);
    this.seed = (options.seed ?? 1) >>> 0;
    this.rng = new Rng(this.seed);
    this.focus = new Hole(this.nextId++);
    this.holes.push(this.focus);
    this.field = new MatterField(this);
    this.prey = new PreyField(this);
    this.comets = new CometField(this);
    this.debris = new DebrisField(this);
    this.dangers = new Dangers(this);
    this.reset();
  }

  /** A new hole at (x, z), fresh as at the start of a life. */
  addHole(x = 0, z = 0): Hole {
    const hole = new Hole(this.nextId++);
    hole.reset(x, z);
    this.holes.push(hole);
    return hole;
  }

  hole(id: number): Hole | undefined {
    return this.holes.find((h) => h.id === id);
  }

  /** Advance one fixed step. */
  step(): void {
    const dt = this.dt;
    this.time += dt;
    for (const hole of this.holes) hole.capture();
    this.field.capture();
    this.prey.capture();
    this.comets.capture();
    this.debris.capture();
    // Bodies may have been moved since the last step (by tests or the debug console): sort them in afresh.
    this.prey.rebuild();

    for (const hole of this.holes) this.checkMilestone(hole);
    // Big things pull the holes and push them out on contact (a hit sheds mass), and the edge pushes back, before they move.
    this.dangers.update(dt);
    for (const hole of this.holes) hole.move(dt);
    this.dangers.confine();
    for (const hole of this.holes) {
      const before = hole.phase;
      hole.hunger.update(dt);
      if (before !== 'over' && hole.phase === 'over') this.events.push({ type: 'died', hole: hole.id });
    }
    for (const hole of this.holes) this.feed(hole);
    for (const hole of this.holes) if (hole.mass > hole.peakMass) hole.peakMass = hole.mass;
    this.prey.update(dt);
    this.field.update(dt);
    this.comets.update(dt);
    this.debris.update(dt);
    this.tick++;
  }

  /** Eaten on contact: credit the mass now and start the infall, which follows the hole until the body drains into it. */
  swallow(obj: Body, hole: Hole, reclaimed = false): void {
    obj.state = 'eating';
    obj.eatProgress = 0;
    obj.eaterId = hole.id;
    obj.eatOffset.x = obj.position.x - hole.position.x;
    obj.eatOffset.z = obj.position.z - hole.position.z;
    obj.infallWeight = sizeWeight(obj.radius, hole.radius);
    obj.infallTime = lerp(SPAGHETTI.infallTimeMin, SPAGHETTI.infallTimeMax, obj.infallWeight);
    this.eat(hole, obj.mass, { name: obj.className, radius: obj.radius }, reclaimed);
  }

  /** Credit a meal to a hole and queue the 'ate' event. */
  eat(hole: Hole, preyMass: number, what: Meal | null = null, reclaimed = false): void {
    const gained = hole.eat(preyMass, what, reclaimed);
    this.events.push({
      type: 'ate',
      hole: hole.id,
      mass: preyMass,
      gained,
      holeMass: hole.mass,
      holeRadius: hole.radius,
      what,
      reclaimed,
      biggest: what !== null && hole.biggestEaten === what,
    });
  }

  clearEvents(): void {
    this.events.length = 0;
  }

  /**
   * A fresh arena: the focus hole starts a new life at the centre, other holes leave, the field grows back in full,
   * bodies are scattered anew and the start is cleared of anything the hole cannot eat. The random stream carries on.
   */
  reset(): void {
    this.holes.length = 0;
    this.holes.push(this.focus);
    this.events.length = 0;
    this.tick = 0;
    this.time = 0;
    this.focus.reset();
    this.field.reset();
    this.prey.reset();
    this.comets.reset();
    this.debris.reset();
    this.clearStart(this.focus);
  }

  /** Keep the start of a life fair: nothing the hole cannot eat close around it or within pulling reach (food stays). */
  clearStart(hole: Hole): void {
    const clear = ARENA.spawnClearViews * viewDistance(hole.radius);
    this.field.clearAround(hole.position.x, hole.position.z, clear, hole.radius * PREY.edibleRatio, DANGER.pullReach);
  }

  /** The hole eats every edible thing it touches: bodies, grains, comets and debris (its own debris gives no score). */
  private feed(hole: Hole): void {
    if (!hole.canEat) return;
    const r = hole.radius;
    const x = hole.position.x;
    const z = hole.position.z;
    const prey = this.prey;
    const n = prey.query(x, z, r, PREY.eatReach);
    for (let k = 0; k < n; k++) {
      const body = prey.objects[prey.found[k]];
      if (body.state === 'alive' && canSwallow(body.radius, r)) this.swallow(body, hole);
    }
    this.field.feed(hole);
    for (const comet of this.comets.objects) {
      if (comet.active && comet.state === 'alive' && this.touches(hole, comet)) this.swallow(comet, hole);
    }
    for (const frag of this.debris.objects) {
      if (this.debris.edible(frag) && this.touches(hole, frag)) this.swallow(frag, hole, hole.id === frag.ownerId);
    }
  }

  /** True if the hole can swallow `obj` and is close enough to. */
  private touches(hole: Hole, obj: Body): boolean {
    if (!canSwallow(obj.radius, hole.radius)) return false;
    const dx = obj.position.x - hole.position.x;
    const dz = obj.position.z - hole.position.z;
    const reach = hole.radius + obj.radius * PREY.eatReach;
    return dx * dx + dz * dz < reach * reach;
  }

  /** Milestones only go up within a life. Reaching one is an event (the client plays the set piece). */
  private checkMilestone(hole: Hole): void {
    if (hole.phase !== 'playing') return;
    const next = milestoneIndexForMass(hole.mass);
    if (next <= hole.milestone) return;
    hole.milestone = next;
    this.events.push({ type: 'milestone', hole: hole.id, index: next });
  }
}
