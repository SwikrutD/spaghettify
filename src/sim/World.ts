import { ARENA, BOTS, DANGER, HOLES, PLAYER, PREY, SIM, SPAGHETTI } from '../config/index.ts';
import { edgeWidth } from './arena.ts';
import { canSwallow, sizeWeight, type Body } from './body.ts';
import { Bots } from './Bots.ts';
import { CometField } from './CometField.ts';
import { bodyPull, Dangers } from './Dangers.ts';
import { DebrisField } from './DebrisField.ts';
import type { SimEvent } from './events.ts';
import { Hole, topSpeed, viewDistance, type Meal } from './Hole.ts';
import { lerp } from './math.ts';
import { MatterField, type Grain, type GrainVisitor } from './MatterField.ts';
import { generateName } from './names.ts';
import { milestoneIndexForMass } from './milestones.ts';
import { PreyField } from './PreyField.ts';
import { Rng } from './rng.ts';
import { vec2, type Vec2 } from './vec.ts';

export interface WorldOptions {
  /** Seed of the world's random stream and of the procedural field. The same seed and inputs give the same world. */
  seed?: number;
  /** Fixed steps per second (SIM.tickRate by default). */
  tickRate?: number;
  /** Bot holes the arena keeps (0 by default: the client and server ask for BOTS.count). */
  bots?: number;
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
  readonly bots: Bots;
  /** Bot holes kept in the arena: missing ones are added at once, and a bot whose life ends comes back after a delay. */
  botTarget: number;
  /** What happened since the last clearEvents(), oldest first. */
  readonly events: SimEvent[] = [];
  /** Steps and seconds since the world was made or reset. */
  tick = 0;
  time = 0;
  private nextId = 0;
  private readonly spot = vec2();
  // Scratch state while counting the food around a spawn point.
  private foodHole = 0;
  private foodSeen = 0;
  private readonly onFoodSeen: GrainVisitor = (g: Grain) => {
    if (g.radius < this.foodHole * PREY.minRelSize || !canSwallow(g.radius, this.foodHole)) return;
    return ++this.foodSeen >= ARENA.spawnFood;
  };

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
    this.bots = new Bots(this);
    this.botTarget = options.bots ?? 0;
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

    for (const hole of this.holes) {
      this.checkMilestone(hole);
      if (hole.protection > 0) hole.protection = Math.max(0, hole.protection - dt);
    }
    this.bots.update(dt);
    // Big things pull the holes and push them out on contact (a hit sheds mass), and the edge pushes back, before they move.
    this.dangers.update(dt);
    for (const hole of this.holes) hole.move(dt);
    this.dangers.confine();
    this.holesMeet();
    for (const hole of this.holes) {
      const before = hole.phase;
      hole.hunger.update(dt);
      if (before !== 'over' && hole.phase === 'over') this.died(hole);
    }
    this.keepBots(dt);
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
   * A fresh arena: the focus hole starts a new life at the centre, other holes leave (the bots come back as new
   * ones, up to the bot target), the field grows back in full, bodies are scattered anew and the start is cleared of
   * anything the hole cannot eat. The random stream carries on.
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
    this.keepBots(0);
  }

  /** Start a new life for a hole in the running arena: at a clear spawn point, as a fresh pea (or `radius`), protected for a moment. */
  respawn(hole: Hole, radius: number = PLAYER.startRadius): void {
    const p = this.spawnPoint(radius, this.spot);
    hole.reset(p.x, p.z);
    if (radius > PLAYER.startRadius) {
      hole.setRadius(radius);
      hole.milestone = milestoneIndexForMass(hole.mass);
    }
    hole.protection = HOLES.spawnProtection;
    this.clearStart(hole);
  }

  /**
   * A place for a hole of this radius to (re)spawn, into `out`: random tries for one out of sight of every other
   * hole (ARENA.holeClearViews of theirs plus its own view), with no body it cannot eat within pulling reach and
   * some food around it. With no such place, the best of the tries (nothing inedible in reach first, then the
   * furthest from other holes).
   */
  spawnPoint(radius: number, out: Vec2): Vec2 {
    const rng = this.rng;
    const view = viewDistance(radius);
    const spread = ARENA.radius - ARENA.edgeMargin - Math.max(edgeWidth(radius) * 3, radius * 2);
    let bestScore = -Infinity;
    let bestX = 0;
    let bestZ = 0;
    for (let attempt = 0; attempt < ARENA.spawnTries; attempt++) {
      const d = Math.sqrt(rng.next()) * spread;
      const a = rng.next() * Math.PI * 2;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      let spare = Infinity;
      for (const hole of this.holes) {
        if (hole.absent) continue;
        const clear = ARENA.holeClearViews * viewDistance(hole.radius) + view;
        spare = Math.min(spare, Math.hypot(x - hole.position.x, z - hole.position.z) - clear);
      }
      const blocked = this.inedibleNear(x, z, radius, view * ARENA.spawnClearViews);
      const fed = this.foodNear(x, z, radius, view * ARENA.spawnFoodViews);
      const score = Math.min(spare, 1e5) - (blocked ? 1e7 : 0) - (fed ? 0 : 1e6);
      if (score > bestScore) {
        bestScore = score;
        bestX = x;
        bestZ = z;
      }
      if (spare >= 0 && !blocked && fed) break;
    }
    out.x = bestX;
    out.z = bestZ;
    return out;
  }

  /**
   * True if a hole of this radius at (x, z) would feel a pull from the bodies it cannot eat of more than
   * ARENA.spawnMaxPull of its steering authority, or touch one with `margin` to spare.
   */
  private inedibleNear(x: number, z: number, radius: number, margin: number): boolean {
    let ax = 0;
    let az = 0;
    for (const body of this.prey.objects) {
      if (body.state !== 'alive' || canSwallow(body.radius, radius)) continue;
      const dx = body.position.x - x;
      const dz = body.position.z - z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < body.radius + radius + margin) return true;
      const a = bodyPull(body.radius, radius, dist) / dist;
      ax += dx * a;
      az += dz * a;
    }
    return Math.hypot(ax, az) > ARENA.spawnMaxPull;
  }

  /** True if at least ARENA.spawnFood grains this hole could eat (and not specks) lie within `reach` of (x, z). */
  private foodNear(x: number, z: number, radius: number, reach: number): boolean {
    this.foodHole = radius;
    this.foodSeen = 0;
    for (const layer of this.field.layers) {
      if (layer.def.radius[0] >= radius * PREY.edibleRatio) break;
      if (layer.def.radius[1] < radius * PREY.minRelSize) continue;
      this.field.forEach(layer.index, x, z, reach, 0, this.onFoodSeen);
      if (this.foodSeen >= ARENA.spawnFood) return true;
    }
    return false;
  }

  /** Add a bot hole: a new character and name, at a size drawn from `range`, on a clear spawn point. */
  addBot(range: readonly [number, number] = BOTS.respawnRadius, protect = true): Hole {
    const hole = new Hole(this.nextId++);
    this.holes.push(hole);
    this.startBot(hole, range, protect);
    return hole;
  }

  private startBot(hole: Hole, range: readonly [number, number], protect: boolean): void {
    hole.bot = this.bots.create();
    hole.name = generateName(this.rng, (n) => this.holes.some((h) => h !== hole && h.name === n));
    this.respawn(hole, this.rng.logUniform(range[0], range[1]));
    if (!protect) hole.protection = 0;
  }

  /** Keep the arena at its bot target: add the missing ones, and bring back bots whose life ended once their delay is up. */
  private keepBots(dt: number): void {
    let count = 0;
    for (const hole of this.holes) {
      if (!hole.bot) continue;
      count++;
      if (hole.phase !== 'over') continue;
      hole.respawnIn -= dt;
      if (hole.respawnIn <= 0) this.startBot(hole, BOTS.respawnRadius, true);
    }
    // A fresh arena starts with bots of every size, none protected (nobody is watching).
    while (count < this.botTarget) {
      this.addBot(this.tick === 0 ? BOTS.initialRadius : BOTS.respawnRadius, this.tick !== 0);
      count++;
    }
  }

  private died(hole: Hole): void {
    if (hole.bot) hole.respawnIn = this.rng.range(BOTS.respawnDelay[0], BOTS.respawnDelay[1]);
    const eaten = hole.eatenBy >= 0;
    this.events.push({
      type: 'died',
      hole: hole.id,
      cause: eaten ? 'eaten' : 'evaporated',
      by: hole.eatenBy,
      byName: hole.eatenByName,
    });
  }

  /**
   * Holes against holes. A hole at least HOLES.eatRatio times another's radius swallows it once it covers its
   * centre; holes closer in size bump when their cores overlap, and both shed mass. A hole in its spawn protection
   * (or already being swallowed) takes no part.
   */
  private holesMeet(): void {
    const holes = this.holes;
    for (let i = 0; i < holes.length; i++) {
      const a = holes[i];
      for (let j = i + 1; j < holes.length; j++) {
        const b = holes[j];
        if (a.phase !== 'playing' || a.protection > 0) break;
        if (b.phase !== 'playing' || b.protection > 0) continue;
        const dx = b.position.x - a.position.x;
        const dz = b.position.z - a.position.z;
        const sum = a.radius + b.radius;
        const distSq = dx * dx + dz * dz;
        if (distSq >= sum * sum) continue;
        const dist = Math.sqrt(distSq);
        const [big, small] = a.radius >= b.radius ? [a, b] : [b, a];
        if (big.radius >= small.radius * HOLES.eatRatio) {
          if (dist < big.radius * HOLES.coverFraction) this.swallowHole(big, small);
        } else if (dist < sum * HOLES.bumpOverlap && a.invulnerable <= 0 && b.invulnerable <= 0) {
          this.bumpHoles(a, b, dx, dz, dist);
        }
      }
    }
  }

  /** `eater` swallows `victim`: most of its mass transfers now, and the victim spaghettifies into the eater. */
  private swallowHole(eater: Hole, victim: Hole): void {
    victim.eatenBy = eater.id;
    victim.eatenByName = eater.name;
    victim.eatOffset.x = victim.position.x - eater.position.x;
    victim.eatOffset.z = victim.position.z - eater.position.z;
    victim.velocity.x = victim.velocity.z = 0;
    victim.input.x = victim.input.z = 0;
    victim.hunger.beEaten();
    eater.holesEaten++;
    const massBefore = eater.mass;
    this.eat(eater, victim.mass * HOLES.massTransfer, { name: victim.name, radius: victim.radius, hole: true });
    this.events.push({
      type: 'holeEaten',
      eater: eater.id,
      victim: victim.id,
      eaterName: eater.name,
      victimName: victim.name,
      x: eater.position.x,
      z: eater.position.z,
      eaterRadius: eater.radius,
      victimRadius: victim.radius,
      gained: eater.mass - massBefore,
    });
  }

  /** Two holes of near size meet: pushed apart, knocked back, stunned, each sheds DANGER.shedFraction of its mass as debris. */
  private bumpHoles(a: Hole, b: Hole, dx: number, dz: number, dist: number): void {
    // From a to b; a dead-centre meeting picks any direction.
    const nx = dist > 1e-6 ? dx / dist : 1;
    const nz = dist > 1e-6 ? dz / dist : 0;
    const gap = (a.radius + b.radius) * HOLES.bumpOverlap - dist;
    if (gap > 0) {
      const wa = b.mass / (a.mass + b.mass);
      a.position.x -= nx * gap * wa;
      a.position.z -= nz * gap * wa;
      b.position.x += nx * gap * (1 - wa);
      b.position.z += nz * gap * (1 - wa);
    }
    this.bumpOne(a, -nx, -nz);
    this.bumpOne(b, nx, nz);
  }

  private bumpOne(hole: Hole, nx: number, nz: number): void {
    const speed = topSpeed(hole.radius);
    hole.velocity.x = nx * HOLES.bumpKnock * speed;
    hole.velocity.z = nz * HOLES.bumpKnock * speed;
    hole.stun = HOLES.bumpStun;
    hole.invulnerable = DANGER.invulnerableTime;
    const radius = hole.radius;
    const shed = hole.shed(DANGER.shedFraction);
    hole.shedMass += shed;
    hole.hits++;
    this.events.push({ type: 'bumped', hole: hole.id, x: hole.position.x, z: hole.position.z, radius, nx, nz, by: 'hole' });
    this.events.push({ type: 'shed', hole: hole.id, mass: shed });
    this.debris.emit(hole, nx, nz, shed, speed);
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
