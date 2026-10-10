import * as THREE from 'three';
import { DISK, LENSING, QUALITY } from '../config';
import { inView, type DrawnHole, type GroundView } from '../entities/PreyMesh';
import { lerp } from '../sim/math.ts';
import { hash01 } from '../sim/rng.ts';
import type { Hole } from '../sim/Hole.ts';
import type { World } from '../sim/World.ts';
import { MAX_EXTRA_LENSES } from '../render/LensingPass';
import { DiskTurbulence } from './DiskTurbulence';
import { blink, HoleMesh, type EaterSpot } from './HoleMesh';

const tmpNdc = new THREE.Vector3();

/**
 * Every hole in the world as drawn: the local player's HoleMesh plus one for each other hole that is on screen
 * (made on first sight and recycled when the hole leaves the world). They share one disk turbulence map, each with
 * its own temperature and angle so they do not look alike. Also says which holes can eat things in view (the prey
 * stretches toward them) and which other holes bend the picture (the nearest few; see LensingPass).
 */
export class HoleMeshes {
  readonly turbulence = new DiskTurbulence();
  readonly local: HoleMesh;
  /** The group to add to the scene: every hole's meshes. */
  readonly group = new THREE.Group();
  /** Holes in play that are in view, as drawn this frame: the local one first. */
  readonly drawn: DrawnHole[] = [];
  /** Other holes that bend the picture this frame (at most MAX_EXTRA_LENSES). */
  readonly lensExtras: HoleMesh[] = [];
  private readonly byHole = new Map<Hole, HoleMesh>();
  private readonly spare: HoleMesh[] = [];
  private readonly drawnPool: DrawnHole[] = [];
  private readonly candidates: { mesh: HoleMesh; size: number }[] = [];
  private readonly seen = new Set<Hole>();
  private readonly eater: EaterSpot = { x: 0, z: 0 };
  private layers: number = QUALITY.levels[0].diskLayers;
  private localHole: Hole | null = null;

  constructor() {
    this.local = new HoleMesh(this.turbulence);
    this.group.add(this.local.group);
  }

  /** Disk detail of a quality level (the turbulence map is shared; every disk takes the layer count). */
  setDetail(layers: number, octaves: number): void {
    this.turbulence.setDetail(layers, octaves);
    this.layers = layers;
    this.local.disk.setLayers(layers);
    for (const mesh of this.byHole.values()) mesh.disk.setLayers(layers);
    for (const mesh of this.spare) mesh.disk.setLayers(layers);
  }

  /**
   * Update every hole's mesh. `local` is the player's hole (drawn with `local`, the HoleMesh the lens follows), `view`
   * the camera's footprint on the play plane, `camera` places the lens candidates.
   */
  update(dt: number, alpha: number, world: World, local: Hole, view: GroundView, camera: THREE.PerspectiveCamera): void {
    this.turbulence.update(dt);
    this.localHole = local;
    this.drawn.length = 0;
    this.candidates.length = 0;
    this.lensExtras.length = 0;
    this.local.lensed = true;
    this.local.update(dt, local, alpha, this.eaterSpot(world, local, alpha));
    // A hole that was swallowed is gone; one that evaporated stays as the speck it shrank to.
    this.local.group.visible = !(local.phase === 'over' && local.eatenBy >= 0);
    if (local.phase === 'playing') this.draw(this.local, local);

    this.seen.clear();
    for (const hole of world.holes) {
      if (hole === local) continue;
      this.seen.add(hole);
      let mesh = this.byHole.get(hole);
      if (hole.phase === 'over') {
        if (mesh) mesh.group.visible = false;
        continue;
      }
      // Cull by where the hole is (a hole being swallowed stays within its own extent of the eater, which counts as in view).
      const x = lerp(hole.prevX, hole.position.x, alpha);
      const z = lerp(hole.prevZ, hole.position.z, alpha);
      const reach = hole.radius * DISK.outerRadiusMax * 1.3;
      if (!inView(view, x, z, reach)) {
        if (mesh) mesh.group.visible = false;
        continue;
      }
      if (!mesh) mesh = this.acquire(hole);
      if (mesh.gen !== hole.gen) this.look(mesh, hole);
      mesh.group.visible = true;
      mesh.lensed = false;
      mesh.update(dt, hole, alpha, this.eaterSpot(world, hole, alpha));
      mesh.disk.starvation = Math.max(hole.hunger.level, blink(hole));
      if (hole.phase === 'playing') {
        this.draw(mesh, hole);
        this.rank(mesh, camera);
      }
    }
    // Meshes of holes that left the world go back to the pool.
    for (const [hole, mesh] of this.byHole) {
      if (this.seen.has(hole)) continue;
      mesh.group.visible = false;
      this.byHole.delete(hole);
      this.spare.push(mesh);
    }
    // The nearest few (by size on screen) bend the picture.
    this.candidates.sort((a, b) => b.size - a.size);
    for (let i = 0; i < Math.min(this.candidates.length, MAX_EXTRA_LENSES, LENSING.extraLenses); i++) {
      const mesh = this.candidates[i].mesh;
      mesh.lensed = true;
      mesh.disk.setLensed(true);
      this.lensExtras.push(mesh);
    }
  }

  /** The mesh a hole is drawn with, if it has one right now. */
  meshOf(hole: Hole | undefined): HoleMesh | undefined {
    if (!hole) return undefined;
    return hole === this.localHole ? this.local : this.byHole.get(hole);
  }

  /** A fresh life for the local hole. */
  reset(local: Hole): void {
    this.localHole = local;
    this.local.reset(local);
  }

  /** Mesh for a hole not drawn so far: a recycled one or a new one, with the hole's own look. */
  private acquire(hole: Hole): HoleMesh {
    let mesh = this.spare.pop();
    if (!mesh) {
      mesh = new HoleMesh(this.turbulence);
      mesh.disk.setLayers(this.layers);
      this.group.add(mesh.group);
    }
    this.byHole.set(hole, mesh);
    mesh.gen = -1;
    return mesh;
  }

  /** The look of this life of a hole: a cooler or hotter disk turned to its own angle, cold at the start. */
  private look(mesh: HoleMesh, hole: Hole): void {
    const seed = Math.imul(hole.id + 1, 7919) + hole.gen * 131;
    mesh.reset(hole);
    mesh.setLook(lerp(0.8, 1.25, hash01(seed, 0)), hash01(seed, 1) * Math.PI * 2);
  }

  /** Where the hole eating `hole` is drawn (only meaningful while `hole` is being swallowed). */
  private eaterSpot(world: World, hole: Hole, alpha: number): EaterSpot {
    const eater = hole.phase === 'eaten' ? world.hole(hole.eatenBy) : undefined;
    if (eater) {
      this.eater.x = lerp(eater.prevX, eater.position.x, alpha);
      this.eater.z = lerp(eater.prevZ, eater.position.z, alpha);
    } else {
      this.eater.x = hole.position.x;
      this.eater.z = hole.position.z;
    }
    return this.eater;
  }

  private draw(mesh: HoleMesh, hole: Hole): void {
    const entry = this.drawnPool[this.drawn.length] ?? (this.drawnPool[this.drawn.length] = { x: 0, z: 0, radius: 1 });
    entry.x = mesh.position.x;
    entry.z = mesh.position.z;
    entry.radius = hole.radius;
    this.drawn.push(entry);
  }

  /** Remember a visible hole as a lens candidate if its core is big enough on screen and it is in the picture. */
  private rank(mesh: HoleMesh, camera: THREE.PerspectiveCamera): void {
    const ndc = tmpNdc.copy(mesh.position).project(camera);
    if (Math.abs(ndc.x) > 1.05 || Math.abs(ndc.y) > 1.05) return;
    const distance = camera.position.distanceTo(mesh.position);
    const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const size = (0.5 * mesh.radius) / distance / tanHalfFov;
    if (size >= LENSING.extraMinCore) this.candidates.push({ mesh, size });
  }
}
