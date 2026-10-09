import { PREY, SIM, SPAGHETTI, TIER_UP, TIERS, tierIndexForMass } from '../config/index.ts';
import { canSwallow, sizeWeight, type Body } from './body.ts';
import { CometField } from './CometField.ts';
import { Dangers } from './Dangers.ts';
import { DebrisField } from './DebrisField.ts';
import type { SimEvent } from './events.ts';
import { Hole, type Meal } from './Hole.ts';
import { lerp, smoothstep } from './math.ts';
import { PreyField } from './PreyField.ts';
import { Rng } from './rng.ts';

export interface WorldOptions {
  /** Seed of the world's random stream. The same seed and the same inputs give the same world. */
  seed?: number;
  /** Fixed steps per second (SIM.tickRate by default). */
  tickRate?: number;
}

/**
 * The whole game state and its rules, stepped at a fixed rate: holes (the local player is one, driven by its
 * input vector), prey, comets and debris. Pure and deterministic: no three.js, DOM or browser APIs, and every
 * random choice comes from `rng`, so the server can run it too. Renderers, audio and UI only read its state
 * and drain `events`.
 *
 * Until the mixed arena (M16) the prey field, comets and despawning follow one hole, the `focus` (the local
 * player): bodies spawn around it at distances in its view, its tier picks the prey table, and its tier-up
 * slows the world for a moment.
 */
export class World {
  /** Real seconds per step. */
  readonly dt: number;
  readonly rng: Rng;
  readonly holes: Hole[] = [];
  readonly focus: Hole;
  readonly prey: PreyField;
  readonly comets: CometField;
  readonly debris: DebrisField;
  readonly dangers: Dangers;
  /** What happened since the last clearEvents(), oldest first. */
  readonly events: SimEvent[] = [];
  /** Steps since the world was made or reset. */
  tick = 0;
  private nextId = 0;
  /** Real seconds since the focus hole's last tier-up (infinite before the first). */
  private sinceTierUp = Infinity;

  constructor(options: WorldOptions = {}) {
    this.dt = 1 / (options.tickRate ?? SIM.tickRate);
    this.rng = new Rng(options.seed ?? 1);
    this.focus = this.addHole();
    this.prey = new PreyField(this, TIERS[0]);
    this.comets = new CometField(this, TIERS[0]);
    this.debris = new DebrisField(this);
    this.dangers = new Dangers(this);
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

  /**
   * Game speed multiplier: dips into slow motion right after the focus hole reaches a new tier (the set piece).
   * Each step is a fixed slice of real time; game rules run on that times this.
   */
  get timeScale(): number {
    const t = this.sinceTierUp;
    if (t >= TIER_UP.slowmoTime) return 1;
    const dip = smoothstep(0, 0.08, t) * (1 - smoothstep(TIER_UP.slowmoTime * 0.4, TIER_UP.slowmoTime, t));
    return 1 - (1 - TIER_UP.slowmoScale) * dip;
  }

  /** Advance one fixed step. */
  step(): void {
    const realDt = this.dt;
    for (const hole of this.holes) hole.capture();
    this.prey.capture();
    this.comets.capture();
    this.debris.capture();

    this.sinceTierUp += realDt;
    for (const hole of this.holes) this.checkTier(hole);
    const dt = realDt * this.timeScale;
    // Big bodies pull the holes and push them out on contact (a hit sheds mass), before they move.
    this.dangers.update(dt);
    for (const hole of this.holes) hole.move(dt);
    for (const hole of this.holes) {
      const before = hole.phase;
      hole.hunger.update(dt, realDt);
      if (before !== 'over' && hole.phase === 'over') this.events.push({ type: 'died', hole: hole.id });
    }
    this.prey.update(dt);
    this.comets.update(dt);
    this.debris.update(dt);
    for (const hole of this.holes) hole.view.update(realDt, hole.radius);
    this.tick++;
  }

  /** The first hole that can swallow `obj` and touches it eats it. `ownerId`: whose shed debris it is (eating it back is not score). */
  feedOn(obj: Body, ownerId = -1): boolean {
    for (const hole of this.holes) {
      if (!hole.canEat || !canSwallow(obj.radius, hole.radius)) continue;
      const dx = obj.position.x - hole.position.x;
      const dz = obj.position.z - hole.position.z;
      const reach = hole.radius + obj.radius * PREY.eatReach;
      if (dx * dx + dz * dz < reach * reach) {
        this.swallow(obj, hole, hole.id === ownerId);
        return true;
      }
    }
    return false;
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

  /** A fresh run: the focus hole starts a new life at the origin, other holes leave, the field refills. The random stream carries on. */
  reset(): void {
    this.holes.length = 0;
    this.holes.push(this.focus);
    this.events.length = 0;
    this.tick = 0;
    this.sinceTierUp = Infinity;
    this.focus.reset();
    this.prey.reset(TIERS[0]);
    this.comets.reset(TIERS[0]);
    this.debris.reset();
  }

  /** Tiers only go up. The focus hole's new tier swaps the prey table and comet timing and slows the world for a moment. */
  private checkTier(hole: Hole): void {
    const next = tierIndexForMass(hole.mass);
    if (next <= hole.tier) return;
    hole.tier = next;
    const tier = TIERS[next];
    hole.view.setTierScale(tier.cameraScale);
    if (hole === this.focus) {
      this.sinceTierUp = 0;
      this.prey.setTier(tier);
      this.comets.setTier(tier);
    }
    this.events.push({ type: 'tier', hole: hole.id, index: next });
  }
}
