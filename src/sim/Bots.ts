import { ARENA, BOTS, HOLES, PREY } from '../config/index.ts';
import { edgeWidth } from './arena.ts';
import { canSwallow } from './body.ts';
import { topSpeed, viewDistance, type Hole } from './Hole.ts';
import type { Grain, GrainVisitor } from './MatterField.ts';
import type { World } from './World.ts';

const OBSTACLE_CAPACITY = 64;

/** What a bot is doing, as of its last decision. */
export type BotMode = 'wander' | 'feed' | 'chase' | 'flee';

/** A bot hole's character and plan. The character is drawn at each spawn; the plan is redone every `reaction` seconds. */
export interface BotBrain {
  /** 0..1: how readily it hunts smaller holes and how far away it notices them. */
  aggression: number;
  /** 0..1: how early it runs from bigger holes. */
  caution: number;
  /** Seconds between decisions. */
  reaction: number;
  /** Radians of steering error it drifts around. */
  wobble: number;
  /** Fraction of full input it ever uses. */
  throttle: number;
  /** Seconds until the next decision. */
  think: number;
  mode: BotMode;
  /** The hole it is chasing or fleeing from the most (id), else -1. */
  targetId: number;
  /** Unit direction it steers in now, and the heading it wanders along. */
  dirX: number;
  dirZ: number;
  heading: number;
  /** Current steering error (radians). */
  offset: number;
}

/**
 * Drives the bot holes. Each bot decides every `reaction` seconds (a reaction delay, jittered): flee from bigger
 * holes, hunt smaller ones, else steer for the best meal in sight, else wander; steer around bodies it cannot eat
 * and away from the gas wall. It only ever writes `hole.input`, exactly like a player's input, so it is bound by
 * the same speed, stun and rules. Pure and deterministic: all randomness comes from the world's Rng.
 */
export class Bots {
  private readonly world: World;
  // Scratch state while a bot decides (the grain visitors are made once, so a decision allocates nothing).
  private px = 0;
  private pz = 0;
  private pr = 0;
  private bestScore = 0;
  private bestX = 0;
  private bestZ = 0;
  private obstacleX = 0;
  private obstacleZ = 0;
  private baseX = 0;
  private baseZ = 0;
  private lookahead = 0;
  /** Bodies and grains the current bot cannot eat, within its sight: x, z, radius for each (extras beyond the capacity are ignored). */
  private readonly obstacles = new Float64Array(OBSTACLE_CAPACITY * 3);
  private obstacleCount = 0;
  private readonly onFood: GrainVisitor = (g: Grain) => {
    if (!canSwallow(g.radius, this.pr) || g.radius < this.pr * PREY.minRelSize) return;
    this.consider(g.x, g.z, g.radius * g.radius);
  };
  private readonly onObstacle: GrainVisitor = (g: Grain) => {
    if (!canSwallow(g.radius, this.pr)) this.addObstacle(g.x, g.z, g.radius);
  };

  constructor(world: World) {
    this.world = world;
  }

  /** A new character, fresh plan. */
  create(): BotBrain {
    const rng = this.world.rng;
    const t = BOTS.temperament;
    const brain: BotBrain = {
      aggression: rng.range(t.aggression[0], t.aggression[1]),
      caution: rng.range(t.caution[0], t.caution[1]),
      reaction: rng.range(t.reaction[0], t.reaction[1]),
      wobble: rng.range(t.wobble[0], t.wobble[1]),
      throttle: rng.range(t.throttle[0], t.throttle[1]),
      think: 0,
      mode: 'wander',
      targetId: -1,
      dirX: 0,
      dirZ: 0,
      heading: rng.next() * Math.PI * 2,
      offset: 0,
    };
    brain.think = rng.next() * brain.reaction;
    brain.dirX = Math.cos(brain.heading);
    brain.dirZ = Math.sin(brain.heading);
    return brain;
  }

  /** Before the holes move: each bot in play decides when its reaction time is up, and writes its input. */
  update(dt: number): void {
    for (const hole of this.world.holes) {
      const brain = hole.bot;
      if (!brain) continue;
      if (hole.phase !== 'playing') {
        hole.input.x = hole.input.z = 0;
        continue;
      }
      brain.think -= dt;
      if (brain.think <= 0) {
        this.decide(hole, brain);
        brain.think = brain.reaction * this.world.rng.range(0.7, 1.3);
      }
      hole.input.x = brain.dirX * brain.throttle;
      hole.input.z = brain.dirZ * brain.throttle;
    }
  }

  private decide(hole: Hole, brain: BotBrain): void {
    const world = this.world;
    const rng = world.rng;
    const r = hole.radius;
    const x = hole.position.x;
    const z = hole.position.z;
    this.px = x;
    this.pz = z;
    this.pr = r;
    const view = viewDistance(r);

    // Other holes: run from bigger ones, hunt smaller ones.
    let fleeX = 0;
    let fleeZ = 0;
    let threat = 0;
    let threatId = -1;
    let threatWeight = 0;
    let prey: Hole | null = null;
    let preyScore = 0;
    for (const other of world.holes) {
      if (other === hole || other.phase !== 'playing' || other.protection > 0) continue;
      const dx = other.position.x - x;
      const dz = other.position.z - z;
      const d = Math.max(Math.hypot(dx, dz), 1e-6);
      const ratio = other.radius / r;
      if (ratio >= HOLES.eatRatio * 0.9) {
        // Bigger (or nearly): run when it is close, harder the closer it is, and sooner for a cautious bot.
        const range = other.radius * (BOTS.fearBase + BOTS.fearPerCaution * brain.caution) + topSpeed(other.radius) * BOTS.fearSeconds;
        if (d >= range) continue;
        const u = 1 - d / range;
        const w = u * u * (ratio >= HOLES.eatRatio ? 1 : 0.4);
        fleeX -= (dx / d) * w;
        fleeZ -= (dz / d) * w;
        threat += w;
        if (w > threatWeight) {
          threatWeight = w;
          threatId = other.id;
        }
      } else if (r / other.radius >= HOLES.eatRatio * BOTS.huntMargin) {
        const range = view * (BOTS.huntBase + BOTS.huntPerAggression * brain.aggression);
        if (d >= range || (other.mass < hole.mass * BOTS.huntMinMassFraction && d > r * 8)) continue;
        const score = (other.mass * HOLES.massTransfer * BOTS.huntBonus * (0.5 + brain.aggression)) / ((d + r * 2) * (d + r * 2));
        if (score > preyScore) {
          preyScore = score;
          prey = other;
        }
      }
    }

    // What it cannot eat nearby (to steer around, and to leave the meals beside it alone).
    const sight = view * BOTS.sightViews;
    const bodies = world.prey;
    const field = world.field;
    this.lookahead = topSpeed(r) * (BOTS.lookaheadSeconds + brain.reaction) + r * 3;
    this.obstacleCount = 0;
    const reach = Math.max(sight, this.lookahead + r * BOTS.avoidMargin);
    const m = bodies.query(x, z, reach, BOTS.avoidMargin);
    for (let k = 0; k < m; k++) {
      const body = bodies.objects[bodies.found[k]];
      if (body.state === 'alive' && !canSwallow(body.radius, r)) this.addObstacle(body.position.x, body.position.z, body.radius);
    }
    for (const layer of field.layers) {
      if (layer.def.radius[1] < r * PREY.edibleRatio) continue;
      field.forEach(layer.index, x, z, reach, BOTS.avoidMargin, this.onObstacle);
    }

    // The best meal in sight.
    this.bestScore = 0;
    this.bestX = x;
    this.bestZ = z;
    const n = bodies.query(x, z, sight, 0);
    for (let k = 0; k < n; k++) {
      const body = bodies.objects[bodies.found[k]];
      if (body.state === 'alive' && canSwallow(body.radius, r)) this.consider(body.position.x, body.position.z, body.mass);
    }
    for (const frag of world.debris.objects) {
      if (world.debris.edible(frag) && canSwallow(frag.radius, r)) this.consider(frag.position.x, frag.position.z, frag.mass);
    }
    for (const comet of world.comets.objects) {
      if (comet.active && comet.state === 'alive' && canSwallow(comet.radius, r)) this.consider(comet.position.x, comet.position.z, comet.mass);
    }
    for (const layer of field.layers) {
      if (layer.def.radius[0] >= r * PREY.edibleRatio) break;
      if (layer.def.radius[1] < r * PREY.minRelSize) continue;
      field.forEach(layer.index, x, z, sight, 0, this.onFood);
    }
    const foodScore = this.bestScore;

    // What it wants: away from a threat, else toward the hole it hunts, else the meal, else wherever it drifts.
    let wantX = 0;
    let wantZ = 0;
    let mode: BotMode = 'wander';
    brain.targetId = -1;
    const flight = Math.min(1, threat);
    if (prey && preyScore > foodScore * 0.5) {
      // Lead the target by the time it takes to get there.
      const dx = prey.position.x - x;
      const dz = prey.position.z - z;
      const lead = Math.min(1.2, Math.hypot(dx, dz) / Math.max(topSpeed(r) * 0.9, 1e-6));
      wantX = dx + prey.velocity.x * lead;
      wantZ = dz + prey.velocity.z * lead;
      mode = 'chase';
      brain.targetId = prey.id;
    } else if (foodScore > 0) {
      wantX = this.bestX - x;
      wantZ = this.bestZ - z;
      mode = 'feed';
    }
    let len = Math.hypot(wantX, wantZ);
    if (len > 1e-6) {
      wantX /= len;
      wantZ /= len;
    } else {
      // Wandering: the heading drifts, and a bot far from the middle is nudged back toward it.
      brain.heading += rng.range(-1, 1) * BOTS.wanderTurn * brain.reaction * 4;
      wantX = Math.cos(brain.heading);
      wantZ = Math.sin(brain.heading);
      const d = Math.hypot(x, z);
      if (d > ARENA.radius * 0.5) {
        const pull = (d - ARENA.radius * 0.5) / (ARENA.radius * 0.5);
        wantX -= (x / d) * pull * 2;
        wantZ -= (z / d) * pull * 2;
      }
    }
    const goal = mode === 'chase' ? BOTS.weights.chase : mode === 'feed' ? BOTS.weights.food : BOTS.weights.wander;
    let dirX = wantX * goal * (1 - flight);
    let dirZ = wantZ * goal * (1 - flight);
    if (flight > 0) {
      const fl = Math.hypot(fleeX, fleeZ) || 1;
      dirX += (fleeX / fl) * BOTS.weights.flee * flight;
      dirZ += (fleeZ / fl) * BOTS.weights.flee * flight;
      mode = 'flee';
      brain.targetId = threatId;
    }
    // The gas wall.
    const dist = Math.hypot(x, z);
    const inner = ARENA.radius - edgeWidth(r) * 1.5;
    if (dist > inner && dist > 1e-6) {
      const u = Math.min(1, (dist - inner) / edgeWidth(r));
      dirX -= (x / dist) * BOTS.weights.wall * u;
      dirZ -= (z / dist) * BOTS.weights.wall * u;
    }
    // Bodies it cannot eat: if its path ahead (a second or so at its speed) would touch one, it bends around it.
    this.obstacleX = 0;
    this.obstacleZ = 0;
    const baseLen = Math.hypot(dirX, dirZ);
    this.baseX = baseLen > 1e-6 ? dirX / baseLen : Math.cos(brain.heading);
    this.baseZ = baseLen > 1e-6 ? dirZ / baseLen : Math.sin(brain.heading);
    for (let k = 0; k < this.obstacleCount; k++) this.avoid(this.obstacles[k * 3], this.obstacles[k * 3 + 1], this.obstacles[k * 3 + 2]);
    dirX += this.obstacleX;
    dirZ += this.obstacleZ;

    len = Math.hypot(dirX, dirZ);
    if (len < 1e-6) {
      dirX = Math.cos(brain.heading);
      dirZ = Math.sin(brain.heading);
    } else {
      dirX /= len;
      dirZ /= len;
    }
    // Steering error: drifts toward a new random offset each decision.
    brain.offset += (rng.range(-1, 1) * brain.wobble - brain.offset) * 0.5;
    const c = Math.cos(brain.offset);
    const s = Math.sin(brain.offset);
    brain.dirX = dirX * c - dirZ * s;
    brain.dirZ = dirX * s + dirZ * c;
    brain.mode = mode;
  }

  /** A candidate meal of this mass at (x, z): keep it if it beats the best so far. */
  private consider(x: number, z: number, mass: number): void {
    for (let k = 0; k < this.obstacleCount; k++) {
      const o = k * 3;
      const ex = x - this.obstacles[o];
      const ez = z - this.obstacles[o + 1];
      const near = this.obstacles[o + 2] * BOTS.mealClearance + this.pr * 2;
      if (ex * ex + ez * ez < near * near) return;
    }
    const dx = x - this.px;
    const dz = z - this.pz;
    const d = Math.sqrt(dx * dx + dz * dz) + this.pr * 2;
    const score = mass / (d * d);
    if (score > this.bestScore) {
      this.bestScore = score;
      this.bestX = x;
      this.bestZ = z;
    }
  }

  private addObstacle(x: number, z: number, radius: number): void {
    if (this.obstacleCount >= OBSTACLE_CAPACITY) return;
    const o = this.obstacleCount++ * 3;
    this.obstacles[o] = x;
    this.obstacles[o + 1] = z;
    this.obstacles[o + 2] = radius;
  }

  /**
   * Something the bot cannot eat at (bx, bz): if the straight path ahead passes closer than the clearance, push
   * sideways (away from the body at the closest point), harder the deeper the path cuts into it and the sooner it
   * would arrive. A body closer than that also pushes straight away.
   */
  private avoid(bx: number, bz: number, br: number): void {
    const px = this.px;
    const pz = this.pz;
    const clearance = (this.pr + br) * BOTS.avoidClearance;
    const rx = bx - px;
    const rz = bz - pz;
    // Closest point of the path (from the bot, along its heading, lookahead long) to the body.
    const along = Math.min(this.lookahead, Math.max(0, rx * this.baseX + rz * this.baseZ));
    const cx = px + this.baseX * along;
    const cz = pz + this.baseZ * along;
    let ox = cx - bx;
    let oz = cz - bz;
    let gap = Math.sqrt(ox * ox + oz * oz);
    if (gap >= clearance) return;
    if (gap < 1e-6) {
      // Dead ahead: slide to one side.
      ox = -this.baseZ;
      oz = this.baseX;
      gap = 1e-6;
    } else {
      ox /= gap;
      oz /= gap;
    }
    const depth = 1 - gap / clearance;
    const soon = 1 - 0.6 * (along / this.lookahead);
    const w = depth * soon * BOTS.weights.avoid;
    // The sideways push, plus a share of the way along the heading's perpendicular so a head-on path still picks a side.
    this.obstacleX += ox * w;
    this.obstacleZ += oz * w;
    const dist = Math.sqrt(rx * rx + rz * rz);
    if (dist < clearance * 1.4) {
      const u = 1 - dist / (clearance * 1.4);
      this.obstacleX -= (rx / Math.max(dist, 1e-6)) * u * u * BOTS.weights.avoid;
      this.obstacleZ -= (rz / Math.max(dist, 1e-6)) * u * u * BOTS.weights.avoid;
    }
  }
}
