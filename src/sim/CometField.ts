import { ARENA, COMETS } from '../config/index.ts';
import { capture, createBody, spawned, type Body } from './body.ts';
import { massOfRadius, viewDistance, type Hole } from './Hole.ts';
import type { World } from './World.ts';

/** A pooled comet: an icy nucleus (a body, so it spaghettifies when eaten) that the renderer gives a tail. */
export interface Comet extends Body {
  /** False for an idle pool slot. */
  active: boolean;
  /** 0..1 tail and coma brightness: fades in on entry and out during the infall. */
  fade: number;
}

/**
 * Comets, the roaming hazard. Every hole in play draws one now and then (its own timer): it enters just outside
 * that hole's view and crosses it on a straight line, sized for that hole. One a hole cannot eat knocks it back
 * (see Dangers); a small one is a fast meal, for any hole. A comet is gone once it is far from every hole and
 * heading away from all of them, or out of the arena. Fixed pool shared by the arena.
 */
export class CometField {
  readonly objects: Comet[] = [];
  /** Comets launched since the last reset (tests). */
  launched = 0;
  private readonly world: World;

  constructor(world: World) {
    this.world = world;
    for (let i = 0; i < COMETS.poolSize; i++) {
      const comet: Comet = Object.assign(createBody(COMETS.color), { active: false, fade: 0 });
      comet.className = 'comet';
      this.objects.push(comet);
    }
  }

  /** No comets out; every hole waits the first delay again. */
  reset(): void {
    this.launched = 0;
    for (const comet of this.objects) comet.active = false;
    for (const hole of this.world.holes) hole.cometTimer = COMETS.firstDelay;
  }

  /** Launch a comet at `hole`: it enters on a ring just outside the hole's view, aimed near it. Null when the pool is full. */
  spawn(hole: Hole): Comet | null {
    const rng = this.world.rng;
    const view = viewDistance(hole.radius);
    const p = hole.position;
    const angle = rng.next() * Math.PI * 2;
    const x = p.x + Math.cos(angle) * COMETS.spawnDistance * view;
    const z = p.z + Math.sin(angle) * COMETS.spawnDistance * view;
    const aimAngle = rng.next() * Math.PI * 2;
    const aim = Math.sqrt(rng.next()) * COMETS.aimSpread * view;
    const dx = p.x + Math.cos(aimAngle) * aim - x;
    const dz = p.z + Math.sin(aimAngle) * aim - z;
    const speed = (rng.range(COMETS.speed[0], COMETS.speed[1]) * view) / Math.max(1e-6, Math.hypot(dx, dz));
    const relative = hole.radius * rng.logUniform(COMETS.relRadius[0], COMETS.relRadius[1]);
    const radius = Math.min(COMETS.maxRadius, Math.max(COMETS.minRadius, relative));
    return this.launch(x, z, dx * speed, dz * speed, radius);
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
    const rng = this.world.rng;
    for (const hole of this.world.holes) {
      if (hole.phase !== 'playing') continue;
      hole.cometTimer -= dt;
      if (hole.cometTimer > 0) continue;
      hole.cometTimer = rng.range(COMETS.interval[0], COMETS.interval[1]);
      this.spawn(hole);
    }

    const edge = ARENA.radius * 1.5;
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
      const p = comet.position;
      if (p.x * p.x + p.z * p.z > edge * edge || this.leftEveryone(comet)) comet.active = false;
    }
  }

  /** True once the comet is far from every hole in play and moving away from each of them. */
  private leftEveryone(comet: Comet): boolean {
    for (const hole of this.world.holes) {
      if (hole.phase === 'over') continue;
      const dx = comet.position.x - hole.position.x;
      const dz = comet.position.z - hole.position.z;
      const far = COMETS.despawnDistance * viewDistance(hole.radius);
      if (dx * dx + dz * dz < far * far || dx * comet.velocity.x + dz * comet.velocity.z <= 0) return false;
    }
    return true;
  }
}
