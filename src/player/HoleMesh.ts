import * as THREE from 'three';
import { DANGER, PLAYER } from '../config';
import { lerp } from '../sim/math.ts';
import type { Hole } from '../sim/Hole.ts';
import { CORE_LAYER } from '../render/layers';
import { AccretionDisk } from './AccretionDisk';

/** 0..1 disk dimming while a hole is invulnerable after a hit (the disk blinks). */
export function blink(hole: Hole): number {
  if (hole.invulnerable <= 0) return 0;
  const t = DANGER.invulnerableTime - hole.invulnerable;
  return Math.sin(t * DANGER.blinkRate * Math.PI * 2) > 0 ? DANGER.blinkDim : 0;
}

/**
 * What a hole looks like: a black core with an accretion disk and photon ring, the group scaled by the radius.
 * Reads the sim hole each frame, interpolated between steps. Gameplay runs on the XZ plane (y = 0).
 */
export class HoleMesh {
  readonly group = new THREE.Group();
  /** Rendered position (between the last two steps). */
  readonly position = this.group.position;
  /** Rendered radius (between the last two steps), without the hit squash. */
  radius: number = PLAYER.startRadius;
  readonly disk = new AccretionDisk();
  /** Seconds left of a hit's squash. */
  private squashLeft = 0;

  constructor() {
    const core = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    // Not on the default layer: the core is drawn over the lensed image (never bent) and again
    // after bloom so the shadow stays crisp (see LensingPass and CorePass).
    core.layers.set(CORE_LAYER);
    this.group.add(core, this.disk.group);
    this.applyScale();
  }

  /** A hit shed mass: the core flattens and springs back (the radius itself drops in the sim). */
  squash(): void {
    this.squashLeft = DANGER.squashTime;
  }

  /** `dt` is game seconds since the last frame, `alpha` (0..1) how far this frame is between the last two steps. */
  update(dt: number, hole: Hole, alpha: number): void {
    this.position.set(lerp(hole.prevX, hole.position.x, alpha), 0, lerp(hole.prevZ, hole.position.z, alpha));
    this.radius = lerp(hole.prevRadius, hole.radius, alpha);
    this.squashLeft = Math.max(0, this.squashLeft - dt);
    this.applyScale();
    this.disk.update(dt, hole.eatenMass / hole.startMass);
  }

  /** A fresh life: no squash, cold disk, at the hole. */
  reset(hole: Hole): void {
    this.squashLeft = 0;
    this.disk.reset();
    this.update(0, hole, 1);
  }

  /** Group scale: the radius, flattened and widened a little by a hit's squash (a damped wobble). */
  private applyScale(): void {
    const r = this.radius;
    if (this.squashLeft <= 0) {
      this.group.scale.setScalar(r);
      return;
    }
    const t = 1 - this.squashLeft / DANGER.squashTime;
    const w = DANGER.squashAmount * Math.sin(t * Math.PI * 2) * (1 - t);
    this.group.scale.set(r * (1 + w * 0.5), r * (1 - w), r * (1 + w * 0.5));
  }
}
