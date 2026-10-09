import { COMETS, DANGER, PLAYER } from '../config';
import type { CometField } from '../entities/CometField';
import type { PreyField } from '../entities/PreyField';
import { canSwallow, type PreyObject } from '../entities/PreyMesh';
import type { Hunger } from '../player/Hunger';
import { topSpeed, type Player } from '../player/Player';

/** What a hit did, for the feedback (camera, sound, the shed burst). Reused, never reallocated. */
export interface HitInfo {
  /** Unit direction the hole was knocked (on the play plane). */
  nx: number;
  nz: number;
  /** Mass lost. */
  shed: number;
  by: 'body' | 'comet';
}

/**
 * Big things are dangerous. Bodies the hole cannot eat pull it toward them (falling off with distance, capped
 * below the hole's steering authority so it can always escape) and hurt it on contact: a knockback, a short
 * stun and a shed of mass, then a short invulnerability. Comets hit the same way. Contact always pushes the
 * hole out of a body, invulnerable or not, so it can never sit inside one.
 */
export class Dangers {
  /** Off: no pull and no contact (tests that need a calm field). */
  enabled = true;
  /** Seconds of invulnerability left. */
  invulnerable = 0;
  /** Hits taken this run. */
  hits = 0;
  /** Mass shed this run. */
  shedMass = 0;
  /** Called on each damaging hit. */
  onHit: ((info: HitInfo) => void) | null = null;
  private readonly info: HitInfo = { nx: 0, nz: 0, shed: 0, by: 'body' };
  private blinkTime = 0;

  constructor(
    private readonly player: Player,
    private readonly prey: PreyField,
    private readonly comets: CometField,
    private readonly hunger: Hunger,
  ) {}

  reset(): void {
    this.invulnerable = 0;
    this.hits = 0;
    this.shedMass = 0;
    this.blinkTime = 0;
    this.player.pull.set(0, 0, 0);
  }

  /** 0..1 disk dimming while invulnerable (the disk blinks). */
  get blink(): number {
    if (this.invulnerable <= 0) return 0;
    return Math.sin(this.blinkTime * DANGER.blinkRate * Math.PI * 2) > 0 ? DANGER.blinkDim : 0;
  }

  /** Before the player moves: pull for this frame, then contacts at the current positions. `dt` is game time. */
  update(dt: number, viewScale: number): void {
    const player = this.player;
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.blinkTime = this.invulnerable > 0 ? this.blinkTime + dt : 0;
    if (!this.enabled) {
      player.pull.set(0, 0, 0);
      return;
    }
    const speed = topSpeed(viewScale);
    this.computePull(PLAYER.responsiveness * speed);

    const objects = this.prey.objects;
    for (let i = 0; i < this.prey.liveCount; i++) {
      const body = objects[i];
      if (body.state === 'alive' && !canSwallow(body.radius, player.radius)) this.contact(body, 0, 0, speed, 'body');
    }
    const comets = this.comets.objects;
    for (let i = 0; i < comets.length; i++) {
      const comet = comets[i];
      if (!comet.active || comet.state !== 'alive' || canSwallow(comet.radius, player.radius)) continue;
      const v = Math.hypot(comet.velocity.x, comet.velocity.z);
      const along = v > 1e-6 ? COMETS.knockAlongTravel / v : 0;
      this.contact(comet, comet.velocity.x * along, comet.velocity.z * along, speed, 'comet');
    }
  }

  /** Sum of the pulls of every body big enough, capped at DANGER.pullMax of the steering authority. */
  private computePull(authority: number): void {
    const player = this.player;
    const pr = player.radius;
    let ax = 0;
    let az = 0;
    const objects = this.prey.objects;
    for (let i = 0; i < this.prey.liveCount; i++) {
      const body = objects[i];
      if (body.state !== 'alive') continue;
      const ratio = body.radius / pr;
      if (ratio < DANGER.pullMinRatio) continue;
      const dx = body.position.x - player.position.x;
      const dz = body.position.z - player.position.z;
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
    player.pull.set(ax * scale, 0, az * scale);
  }

  /** Push the hole out of `body` if they touch; a damaging hit unless invulnerable. (bx, bz) leans the knockback. */
  private contact(body: PreyObject, bx: number, bz: number, speed: number, by: HitInfo['by']): void {
    const player = this.player;
    const dx = player.position.x - body.position.x;
    const dz = player.position.z - body.position.z;
    const min = (player.radius + body.radius) * DANGER.bodyPad;
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
      const v = Math.hypot(player.velocity.x, player.velocity.z);
      nx = v > 1e-6 ? -player.velocity.x / v : 1;
      nz = v > 1e-6 ? -player.velocity.z / v : 0;
    }
    player.position.x = body.position.x + nx * min;
    player.position.z = body.position.z + nz * min;
    // No velocity into the body.
    const vn = player.velocity.x * nx + player.velocity.z * nz;
    if (vn < 0) {
      player.velocity.x -= vn * nx;
      player.velocity.z -= vn * nz;
    }
    if (this.invulnerable > 0 || this.hunger.phase !== 'playing') return;

    let kx = nx + bx;
    let kz = nz + bz;
    const k = Math.hypot(kx, kz) || 1;
    kx /= k;
    kz /= k;
    player.velocity.set(kx * DANGER.knockSpeed * speed, 0, kz * DANGER.knockSpeed * speed);
    player.stun = DANGER.stunTime;
    this.invulnerable = DANGER.invulnerableTime;
    this.blinkTime = 0;

    // Shed mass, but never below a margin over the hunger floor: hits bring starvation closer, they do not end the run.
    const keep = this.hunger.floorMass * DANGER.shedFloorMargin;
    const target = Math.max(player.mass * (1 - DANGER.shedFraction), Math.min(player.mass, keep));
    const shed = player.mass - target;
    player.mass = target;
    this.shedMass += shed;
    this.hits++;

    const info = this.info;
    info.nx = kx;
    info.nz = kz;
    info.shed = shed;
    info.by = by;
    this.onHit?.(info);
  }
}
