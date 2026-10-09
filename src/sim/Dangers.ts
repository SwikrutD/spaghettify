import { COMETS, DANGER, PLAYER } from '../config/index.ts';
import { canSwallow, type Body } from './body.ts';
import { topSpeed, type Hole } from './Hole.ts';
import type { World } from './World.ts';

/**
 * Big things are dangerous. Bodies a hole cannot eat pull it toward them (falling off with distance, capped
 * below the hole's steering authority so it can always escape) and hurt it on contact: a knockback, a short
 * stun and a shed of mass (thrown out as debris), then a short invulnerability. Comets hit the same way.
 * Contact always pushes the hole out of a body, invulnerable or not, so it can never sit inside one.
 */
export class Dangers {
  /** Off: no pull and no contact (tests that need a calm field). */
  enabled = true;
  private readonly world: World;

  constructor(world: World) {
    this.world = world;
  }

  /** Before the holes move: pull for this step, then contacts at the current positions. `dt` is game time. */
  update(dt: number): void {
    for (const hole of this.world.holes) this.updateHole(hole, dt);
  }

  private updateHole(hole: Hole, dt: number): void {
    hole.invulnerable = Math.max(0, hole.invulnerable - dt);
    if (!this.enabled) {
      hole.pull.x = hole.pull.z = 0;
      return;
    }
    const speed = topSpeed(hole.view.viewScale);
    this.computePull(hole, PLAYER.responsiveness * speed);

    const prey = this.world.prey;
    for (let i = 0; i < prey.liveCount; i++) {
      const body = prey.objects[i];
      if (body.state === 'alive' && !canSwallow(body.radius, hole.radius)) this.contact(hole, body, 0, 0, speed, 'body');
    }
    for (const comet of this.world.comets.objects) {
      if (!comet.active || comet.state !== 'alive' || canSwallow(comet.radius, hole.radius)) continue;
      const v = Math.hypot(comet.velocity.x, comet.velocity.z);
      const along = v > 1e-6 ? COMETS.knockAlongTravel / v : 0;
      this.contact(hole, comet, comet.velocity.x * along, comet.velocity.z * along, speed, 'comet');
    }
  }

  /** Sum of the pulls of every body big enough, capped at DANGER.pullMax of the steering authority. */
  private computePull(hole: Hole, authority: number): void {
    const pr = hole.radius;
    let ax = 0;
    let az = 0;
    const prey = this.world.prey;
    for (let i = 0; i < prey.liveCount; i++) {
      const body = prey.objects[i];
      if (body.state !== 'alive') continue;
      const ratio = body.radius / pr;
      if (ratio < DANGER.pullMinRatio) continue;
      const dx = body.position.x - hole.position.x;
      const dz = body.position.z - hole.position.z;
      const reach = body.radius * DANGER.pullReach;
      const distSq = dx * dx + dz * dz;
      if (distSq >= reach * reach || distSq < 1e-8) continue;
      const dist = Math.sqrt(distSq);
      const size = Math.min(1, (ratio - DANGER.pullMinRatio) / (DANGER.pullFullRatio - DANGER.pullMinRatio));
      const falloff = Math.pow(body.radius / Math.max(dist, body.radius), DANGER.pullFalloff);
      const edge = 1 - distSq / (reach * reach);
      const a = (DANGER.pullStrength * authority * size * falloff * edge * edge) / dist;
      ax += dx * a;
      az += dz * a;
    }
    const mag = Math.hypot(ax, az);
    const cap = DANGER.pullMax * authority;
    const scale = mag > cap ? cap / mag : 1;
    hole.pull.x = ax * scale;
    hole.pull.z = az * scale;
  }

  /** Push the hole out of `body` if they touch; a damaging hit unless invulnerable or out of play. (bx, bz) leans the knockback. */
  private contact(hole: Hole, body: Body, bx: number, bz: number, speed: number, by: 'body' | 'comet'): void {
    const p = hole.position;
    const v = hole.velocity;
    const dx = p.x - body.position.x;
    const dz = p.z - body.position.z;
    const min = (hole.radius + body.radius) * DANGER.bodyPad;
    const distSq = dx * dx + dz * dz;
    if (distSq >= min * min) return;
    const dist = Math.sqrt(distSq);
    let nx: number;
    let nz: number;
    if (dist > 1e-6) {
      nx = dx / dist;
      nz = dz / dist;
    } else {
      // Dead centre: back out the way it came, or any way.
      const s = Math.hypot(v.x, v.z);
      nx = s > 1e-6 ? -v.x / s : 1;
      nz = s > 1e-6 ? -v.z / s : 0;
    }
    p.x = body.position.x + nx * min;
    p.z = body.position.z + nz * min;
    // No velocity into the body.
    const vn = v.x * nx + v.z * nz;
    if (vn < 0) {
      v.x -= vn * nx;
      v.z -= vn * nz;
    }
    if (hole.invulnerable > 0 || hole.phase !== 'playing') return;

    let kx = nx + bx;
    let kz = nz + bz;
    const k = Math.hypot(kx, kz) || 1;
    kx /= k;
    kz /= k;
    v.x = kx * DANGER.knockSpeed * speed;
    v.z = kz * DANGER.knockSpeed * speed;
    hole.stun = DANGER.stunTime;
    hole.invulnerable = DANGER.invulnerableTime;

    // Shed mass (never below the start mass); a hit alone never starves the hole, so the hunger floor drops with it.
    const radius = hole.radius;
    const shed = hole.shed(DANGER.shedFraction);
    hole.hunger.forgiveHit(DANGER.hitFloorGap);
    hole.shedMass += shed;
    hole.hits++;
    const world = this.world;
    world.events.push({ type: 'bumped', hole: hole.id, x: p.x, z: p.z, radius, nx: kx, nz: kz, by });
    world.events.push({ type: 'shed', hole: hole.id, mass: shed });
    world.debris.emit(hole, kx, kz, shed, speed);
  }
}
