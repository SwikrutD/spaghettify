import * as THREE from 'three';
import { DANGER, DISK, HOLES, PLAYER } from '../config';
import { lerp, smoothstep } from '../sim/math.ts';
import type { Hole } from '../sim/Hole.ts';
import { CORE_LAYER } from '../render/layers';
import { AccretionDisk } from './AccretionDisk';
import type { DiskTurbulence } from './DiskTurbulence';

/** 0..1 disk dimming while a hole is invulnerable after a hit or protected after spawning (the disk blinks). */
export function blink(hole: Hole): number {
  let t: number;
  if (hole.invulnerable > 0) t = DANGER.invulnerableTime - hole.invulnerable;
  else if (hole.protection > 0) t = hole.protection;
  else return 0;
  return Math.sin(t * DANGER.blinkRate * Math.PI * 2) > 0 ? DANGER.blinkDim : 0;
}

/** Where the hole eating a hole is drawn this frame (x, z). */
export interface EaterSpot {
  x: number;
  z: number;
}

/**
 * What a hole looks like: a black core with an accretion disk and photon ring, the group scaled by the radius.
 * Reads the sim hole each frame, interpolated between steps. Gameplay runs on the XZ plane (y = 0). A hole being
 * swallowed by another is drawn spaghettifying into it: drawn along a spiral into the eater, stretched along the
 * line to it and shrinking away.
 */
export class HoleMesh {
  readonly group = new THREE.Group();
  /** Rendered position (between the last two steps; when being swallowed, on its way into the eater). */
  readonly position = this.group.position;
  /** Rendered core radius (what the lens centres on): the radius, shrinking away while the hole is being swallowed. */
  radius: number = PLAYER.startRadius;
  /** Rendered radius of the hole itself (between the last two steps), however it is being swallowed: what the camera frames. */
  simRadius: number = PLAYER.startRadius;
  readonly disk: AccretionDisk;
  /** True when the screen lens bends the picture around this hole (the disk bends itself to match). */
  lensed = true;
  /** The hole's life this mesh last drew, to notice a respawn. */
  gen = -1;
  /** Added to where the hole is drawn: online, the own hole's correction while it fades out (see src/net/Prediction). */
  readonly drawOffset = { x: 0, z: 0 };
  /** Seconds left of a hit's squash. */
  private squashLeft = 0;

  constructor(turbulence: DiskTurbulence) {
    this.disk = new AccretionDisk(turbulence);
    const core = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    // Not on the default layer: the core is drawn over the lensed image (never bent) and again
    // after bloom so the shadow stays crisp (see LensingPass and CorePass).
    core.layers.set(CORE_LAYER);
    this.group.add(core, this.disk.group);
    this.applyScale(1, 0, 0);
  }

  /** A hit shed mass: the core flattens and springs back (the radius itself drops in the sim). */
  squash(): void {
    this.squashLeft = DANGER.squashTime;
  }

  /** A look for this hole: a temperature scale and the angle the disk's noise is turned to. */
  setLook(kelvinScale: number, phase: number): void {
    this.disk.kelvinScale = kelvinScale;
    this.disk.setPhase(phase);
    this.disk.applyHeat();
  }

  /**
   * `dt` is game seconds since the last frame, `alpha` (0..1) how far this frame is between the last two steps.
   * `eater` is where the hole swallowing this one is drawn (only read while this hole is being swallowed).
   */
  update(dt: number, hole: Hole, alpha: number, eater?: EaterSpot): void {
    // A swallowed hole stays where it vanished (the camera keeps looking there); the rest of a finished life carries on drawing.
    if (hole.phase === 'over' && hole.eatenBy >= 0) return;
    let x = lerp(hole.prevX, hole.position.x, alpha);
    let z = lerp(hole.prevZ, hole.position.z, alpha);
    this.simRadius = lerp(hole.prevRadius, hole.radius, alpha);
    let radius = this.simRadius;
    let stretch = 1;
    let angle = 0;
    if (hole.phase === 'eaten' && eater) {
      // The infall: the offset from the eater shrinks slowly, then plunges, as it swings around with the disk's spin.
      const t = Math.min(1, lerp(hole.prevEat, hole.eatProgress, alpha));
      const fall = t ** HOLES.accelPower;
      const swirl = DISK.spin * HOLES.swirl * fall;
      const c = Math.cos(swirl);
      const s = Math.sin(swirl);
      const ox = hole.eatOffset.x * c - hole.eatOffset.z * s;
      const oz = hole.eatOffset.x * s + hole.eatOffset.z * c;
      x = eater.x + ox * (1 - fall);
      z = eater.z + oz * (1 - fall);
      stretch = 1 + (HOLES.maxStretch - 1) * (1 - (1 - t) * (1 - t));
      // Stretched along the line to the eater.
      angle = Math.atan2(-(eater.z - z), eater.x - x);
      radius *= 1 - smoothstep(0.4, 1, t);
    }
    this.position.set(x + this.drawOffset.x, 0, z + this.drawOffset.z);
    this.radius = radius;
    this.squashLeft = Math.max(0, this.squashLeft - dt);
    this.applyScale(radius, stretch, angle);
    this.disk.setLensed(this.lensed);
    // Heat follows growth: what it has eaten, or (a bot that started big) its size.
    this.disk.update(dt, Math.max(hole.eatenMass, hole.mass - hole.startMass) / hole.startMass);
  }

  /** A fresh life: no squash, cold disk, at the hole. */
  reset(hole: Hole): void {
    this.squashLeft = 0;
    this.disk.reset();
    this.gen = hole.gen;
    this.update(0, hole, 1);
  }

  /**
   * Group scale: the radius, flattened and widened a little by a hit's squash (a damped wobble), or stretched
   * `stretch` times along the direction `angle` (about the vertical axis) while being swallowed.
   */
  private applyScale(r: number, stretch: number, angle: number): void {
    this.group.rotation.y = stretch > 1 ? angle : 0;
    if (stretch > 1) {
      const across = r / Math.sqrt(stretch);
      this.group.scale.set(r * stretch, across, across);
      return;
    }
    if (this.squashLeft <= 0) {
      this.group.scale.setScalar(r);
      return;
    }
    const t = 1 - this.squashLeft / DANGER.squashTime;
    const w = DANGER.squashAmount * Math.sin(t * Math.PI * 2) * (1 - t);
    this.group.scale.set(r * (1 + w * 0.5), r * (1 - w), r * (1 + w * 0.5));
  }
}
