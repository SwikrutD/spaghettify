import { COMETS, type Tier } from '../config/index.ts';
import { capture, createBody, spawned, type Body } from './body.ts';
import { massOfRadius } from './Hole.ts';
import type { World } from './World.ts';

/** A pooled comet: an icy nucleus (a body, so it spaghettifies when eaten) that the renderer gives a tail. */
export interface Comet extends Body {
  /** False for an idle pool slot. */
  active: boolean;
  /** 0..1 tail and coma brightness: fades in on entry and out during the infall. */
  fade: number;
}

/**
 * Comets, the roaming hazard: they enter just off screen on a timer from the focus hole's tier `comets` table
 * and cross the view on a straight line. One a hole cannot eat knocks it back (see Dangers); once a hole is
 * big enough it is a fast meal. Fixed pool.
 */
export class CometField {
  readonly objects: Comet[] = [];
  /** Comets launched this run (tests). */
  launched = 0;
  private readonly world: World;
  private tier: Tier;
  /** Seconds until the next comet. */
  private timer: number;

  constructor(world: World, tier: Tier) {
    this.world = world;
    this.tier = tier;
    this.timer = tier.comets.firstDelay;
    for (let i = 0; i < COMETS.poolSize; i++) {
      const comet: Comet = Object.assign(createBody(COMETS.color), { active: false, fade: 0 });
      comet.className = 'comet';
      this.objects.push(comet);
    }
  }

  setTier(tier: Tier): void {
    this.tier = tier;
    this.timer = Math.min(this.timer, tier.comets.firstDelay);
  }

  /** Start of a new run: no comets, first one after the tier's delay. */
  reset(tier: Tier): void {
    this.tier = tier;
    this.timer = tier.comets.firstDelay;
    this.launched = 0;
    for (const comet of this.objects) comet.active = false;
  }

  /** Launch a comet from the tier's table: enters on the spawn ring, aimed near the focus hole. */
  spawn(): Comet | null {
    const c = this.tier.comets;
    const rng = this.world.rng;
    const hole = this.world.focus;
    const view = hole.view.targetDistance;
    const p = hole.position;
    const angle = rng.next() * Math.PI * 2;
    const x = p.x + Math.cos(angle) * COMETS.spawnDistance * view;
    const z = p.z + Math.sin(angle) * COMETS.spawnDistance * view;
    const aimAngle = rng.next() * Math.PI * 2;
    const aim = Math.sqrt(rng.next()) * COMETS.aimSpread * view;
    const dx = p.x + Math.cos(aimAngle) * aim - x;
    const dz = p.z + Math.sin(aimAngle) * aim - z;
    const speed = (rng.range(c.speed[0], c.speed[1]) * view) / Math.max(1e-6, Math.hypot(dx, dz));
    return this.launch(x, z, dx * speed, dz * speed, rng.logUniform(c.radius[0], c.radius[1]));
  }

  /** Launch a comet at a given place, velocity (world units per second) and nucleus radius. Null when the pool is full. */
  launch(x: number, z: number, vx: number, vz: number, radius: number): Comet | null {
    const comet = this.objects.find((o) => !o.active);
    if (!comet) return null;
    comet.active = true;
    comet.appear = 1;
    comet.fade = 0;
    comet.radius = radius;
    comet.mass = massOfRadius(radius);
    comet.position.x = x;
    comet.position.z = z;
    comet.velocity.x = vx;
    comet.velocity.z = vz;
    spawned(comet, this.world.rng);
    this.launched++;
    return comet;
  }

  /** Start of a step: remember positions for render interpolation. */
  capture(): void {
    for (const comet of this.objects) capture(comet);
  }

  update(dt: number): void {
    const hole = this.world.focus;
    const despawnSq = (COMETS.despawnDistance * hole.view.targetDistance) ** 2;

    this.timer -= dt;
    if (this.timer <= 0) {
      const c = this.tier.comets;
      this.timer = this.world.rng.range(c.interval[0], c.interval[1]);
      this.spawn();
    }

    for (const comet of this.objects) {
      if (!comet.active) continue;
      if (comet.state === 'eating') {
        comet.eatProgress += dt / comet.infallTime;
        comet.fade = Math.max(0, 1 - comet.eatProgress * 2);
        if (comet.eatProgress >= 1) comet.active = false;
        continue;
      }
      comet.position.x += comet.velocity.x * dt;
      comet.position.z += comet.velocity.z * dt;
      comet.fade = Math.min(1, comet.fade + dt / COMETS.appearTime);
      const dx = comet.position.x - hole.position.x;
      const dz = comet.position.z - hole.position.z;
      // Gone once it is far and heading away.
      if (dx * dx + dz * dz > despawnSq && dx * comet.velocity.x + dz * comet.velocity.z > 0) {
        comet.active = false;
        continue;
      }
      this.world.feedOn(comet);
    }
  }
}
