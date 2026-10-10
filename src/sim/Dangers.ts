import { COMETS, DANGER, PLAYER, PREY } from '../config/index.ts';
import { clampToArena, edgePush } from './arena.ts';
import { canSwallow, createBody, type Body } from './body.ts';
import { topSpeed, type Hole } from './Hole.ts';
import type { Grain, GrainVisitor } from './MatterField.ts';
import { vec2 } from './vec.ts';
import type { World } from './World.ts';

/**
 * Big things are dangerous. Bodies and grains a hole cannot eat pull it toward them (falling off with distance,
 * capped below the hole's steering authority so it can always escape) and hurt it on contact: a knockback, a short
 * stun and a shed of mass (thrown out as debris), then a short invulnerability. Comets hit the same way. Contact
 * always pushes the hole out, invulnerable or not, so it can never sit inside anything. The gas wall at the arena
 * edge pushes every hole back, dangers on or off.
 */
export class Dangers {
  /** Off: no pull and no contact (tests that need a calm field). The arena edge still holds. */
  enabled = true;
  private readonly world: World;
  /** Per-hole state while visiting grains (the visitors are made once, so there are no allocations per step). */
  private hole: Hole | null = null;
  private speed = 0;
  private authority = 0;
  private ax = 0;
  private az = 0;
  private readonly edge = vec2();
  /** A grain seen as a body, for contact. */
  private readonly grainBody: Body = createBody({ hue: [0, 0], sat: [0, 0], light: [0, 0] });
  private readonly onGrainPull: GrainVisitor = (g) => this.addPull(g.x, g.z, g.radius);
  private readonly onGrainContact: GrainVisitor = (g: Grain) => {
    const hole = this.hole!;
    if (canSwallow(g.radius, hole.radius)) return;
    const body = this.grainBody;
    body.position.x = g.x;
    body.position.z = g.z;
    body.radius = g.radius;
    this.contact(hole, body, 0, 0, this.speed, 'body');
  };

  constructor(world: World) {
    this.world = world;
  }

  /** Before the holes move: pull for this step (bodies, grains, the edge), then contacts at the current positions. */
  update(dt: number): void {
    for (const hole of this.world.holes) this.updateHole(hole, dt);
  }

  /** After the holes move: nothing ends up past the hard edge. */
  confine(): void {
    for (const hole of this.world.holes) clampToArena(hole);
  }

  private updateHole(hole: Hole, dt: number): void {
    hole.invulnerable = Math.max(0, hole.invulnerable - dt);
    const speed = topSpeed(hole.radius);
    const authority = PLAYER.responsiveness * speed;
    edgePush(hole.position.x, hole.position.z, hole.radius, authority, this.edge);
    // A life that is over is out of the game: nothing pulls or hits it (the edge still holds it in).
    if (!this.enabled || hole.phase === 'over') {
      hole.pull.x = this.edge.x;
      hole.pull.z = this.edge.z;
      return;
    }
    this.hole = hole;
    this.speed = speed;
    this.authority = authority;
    this.computePull(hole);
    hole.pull.x += this.edge.x;
    hole.pull.z += this.edge.z;

    const prey = this.world.prey;
    const x = hole.position.x;
    const z = hole.position.z;
    const n = prey.query(x, z, hole.radius * DANGER.bodyPad, DANGER.bodyPad);
    for (let k = 0; k < n; k++) {
      const body = prey.objects[prey.found[k]];
      if (body.state === 'alive' && !canSwallow(body.radius, hole.radius)) this.contact(hole, body, 0, 0, speed, 'body');
    }
    const field = this.world.field;
    for (const layer of field.layers) {
      if (layer.def.radius[1] < hole.radius * PREY.edibleRatio) continue;
      field.forEach(layer.index, hole.position.x, hole.position.z, hole.radius * DANGER.bodyPad, DANGER.bodyPad, this.onGrainContact);
    }
    for (const comet of this.world.comets.objects) {
      if (!comet.active || comet.state !== 'alive' || canSwallow(comet.radius, hole.radius)) continue;
      const v = Math.hypot(comet.velocity.x, comet.velocity.z);
      const along = v > 1e-6 ? COMETS.knockAlongTravel / v : 0;
      this.contact(hole, comet, comet.velocity.x * along, comet.velocity.z * along, speed, 'comet');
    }
    this.hole = null;
  }

  /** Sum of the pulls of every body and grain big enough, capped at DANGER.pullMax of the steering authority. */
  private computePull(hole: Hole): void {
    this.ax = 0;
    this.az = 0;
    const x = hole.position.x;
    const z = hole.position.z;
    const prey = this.world.prey;
    const n = prey.query(x, z, 0, DANGER.pullReach);
    for (let k = 0; k < n; k++) {
      const body = prey.objects[prey.found[k]];
      if (body.state === 'alive') this.addPull(body.position.x, body.position.z, body.radius);
    }
    const field = this.world.field;
    for (const layer of field.layers) {
      if (layer.def.radius[1] < hole.radius * DANGER.pullMinRatio) continue;
      field.forEach(layer.index, x, z, 0, DANGER.pullReach, this.onGrainPull);
    }
    const mag = Math.hypot(this.ax, this.az);
    const cap = DANGER.pullMax * this.authority;
    const scale = mag > cap ? cap / mag : 1;
    hole.pull.x = this.ax * scale;
    hole.pull.z = this.az * scale;
  }

  /** Add the pull of a body of radius `br` at (bx, bz) on the current hole, if it is big enough and near enough. */
  private addPull(bx: number, bz: number, br: number): void {
    const hole = this.hole!;
    const ratio = br / hole.radius;
    if (ratio < DANGER.pullMinRatio) return;
    const dx = bx - hole.position.x;
    const dz = bz - hole.position.z;
    const reach = br * DANGER.pullReach;
    const distSq = dx * dx + dz * dz;
    if (distSq >= reach * reach || distSq < 1e-8) return;
    const dist = Math.sqrt(distSq);
    const size = Math.min(1, (ratio - DANGER.pullMinRatio) / (DANGER.pullFullRatio - DANGER.pullMinRatio));
    const falloff = Math.pow(br / Math.max(dist, br), DANGER.pullFalloff);
    const edge = 1 - distSq / (reach * reach);
    const a = (DANGER.pullStrength * this.authority * size * falloff * edge * edge) / dist;
    this.ax += dx * a;
    this.az += dz * a;
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

    // Shed mass, never below the start mass (which is above the evaporation mass, so a hit alone never ends a life).
    const radius = hole.radius;
    const shed = hole.shed(DANGER.shedFraction);
    hole.shedMass += shed;
    hole.hits++;
    const world = this.world;
    world.events.push({ type: 'bumped', hole: hole.id, x: p.x, z: p.z, radius, nx: kx, nz: kz, by });
    world.events.push({ type: 'shed', hole: hole.id, mass: shed });
    world.debris.emit(hole, kx, kz, shed, speed);
  }
}
