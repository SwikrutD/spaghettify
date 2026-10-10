import * as THREE from 'three';
import { PREY } from '../config';
import { createBody, type Body } from '../sim/body.ts';
import type { Grain, GrainVisitor, MatterField } from '../sim/MatterField.ts';
import type { PreyField } from '../sim/PreyField.ts';
import { inView, PreyMesh, type BodyFrame } from './PreyMesh';

/** Placeholder look of the scratch grain body; every grain sets its own layer's colours. */
const PREY_DEFAULT_COLOR = { hue: [0, 0], sat: [0, 0], light: [0.5, 0.5] } as const;
const ROCK_TINY = 0;
const ROCK_LOW = 1;
const ROCK = 2;
const SPHERE = 3;

/**
 * The arena's matter as drawn: the bodies and the procedural field's grains in the camera's footprint, plus
 * everything falling into a hole. Four instanced meshes (rocks at three levels of detail by size on screen, smooth
 * spheres for round bodies), refilled every frame from the visible set: bodies from the sim's grid, grains from the
 * cells in view, skipping anything under PREY.drawMinPixels. Falling bodies go first, then bodies, then grain layers
 * from the biggest down, so if a mesh runs out of room it is the dust that is dropped.
 */
export class PreyFieldMesh {
  /** All three meshes; add this to the scene. */
  readonly group = new THREE.Group();
  private readonly meshes: readonly PreyMesh[];
  private readonly prey: PreyField;
  private readonly field: MatterField;
  /** Per arena body slot: mesh and instance it was drawn as this frame (mesh -1: not drawn). */
  private readonly drawnMesh: Int8Array;
  private readonly drawnIndex: Int32Array;
  /** A grain seen as a body (one at a time), per layer colour. */
  private readonly grainBody: Body = createBody(PREY_DEFAULT_COLOR);
  private frame: BodyFrame | null = null;
  private readonly onGrain: GrainVisitor = (g: Grain) => {
    const frame = this.frame!;
    if (g.radius < PREY.drawMinPixels * frame.view.unitsPerPixel || !inView(frame.view, g.x, g.z, g.radius)) return;
    const body = this.grainBody;
    const layer = this.field.layers[g.layer].def;
    body.position.x = body.prevX = g.x;
    body.position.z = body.prevZ = g.z;
    body.radius = g.radius;
    body.seed = g.seed;
    body.color = layer.color;
    body.round = layer.round ?? false;
    body.appear = Math.min(1, Math.max(0, (frame.world.time - g.born) / PREY.appearTime));
    this.draw(body, frame);
    // Out of room even for the tiniest rocks: nothing smaller will fit either.
    return this.meshes[ROCK_TINY].full;
  };

  constructor(prey: PreyField, field: MatterField) {
    this.prey = prey;
    this.field = field;
    this.meshes = [
      new PreyMesh(PREY.drawBudgetTiny, 'rockTiny'),
      new PreyMesh(PREY.drawBudgetLow, 'rockLow'),
      new PreyMesh(PREY.drawBudgetRock, 'rock'),
      new PreyMesh(PREY.drawBudgetSphere, 'sphere'),
    ];
    for (const m of this.meshes) this.group.add(m.mesh);
    this.drawnMesh = new Int8Array(prey.objects.length).fill(-1);
    this.drawnIndex = new Int32Array(prey.objects.length);
  }

  /** The mesh and instance arena body slot i was drawn as in the last frame, or null if it was not drawn. */
  instanceOf(i: number): { mesh: THREE.InstancedMesh; index: number } | null {
    const m = this.drawnMesh[i];
    return m < 0 ? null : { mesh: this.meshes[m].mesh, index: this.drawnIndex[i] };
  }

  /** Instances drawn last frame, per mesh: tiny, low detail and full detail rocks, spheres. */
  get counts(): number[] {
    return this.meshes.map((m) => m.count);
  }

  update(frame: BodyFrame): void {
    this.frame = frame;
    for (const m of this.meshes) m.begin();
    this.drawnMesh.fill(-1);
    const { x, z, radius, unitsPerPixel } = frame.view;
    const minRadius = PREY.drawMinPixels * unitsPerPixel;

    // Whatever is falling in, wherever its hole is drawn.
    for (const body of this.field.infall) if (body.active) this.draw(body, frame);
    const objects = this.prey.objects;
    for (let i = 0; i < objects.length; i++) if (objects[i].state === 'eating') this.drawSlot(i, frame);
    // Bodies in view.
    const n = this.prey.query(x, z, radius, 1);
    for (let k = 0; k < n; k++) {
      const i = this.prey.found[k];
      const body = objects[i];
      if (body.radius >= minRadius && inView(frame.view, body.position.x, body.position.z, body.radius)) this.drawSlot(i, frame);
    }
    // Grains in view, the biggest layers first.
    const layers = this.field.layers;
    for (let l = layers.length - 1; l >= 0; l--) {
      if (layers[l].def.radius[1] < minRadius) break;
      this.field.forEach(l, x, z, radius, 1, this.onGrain);
    }
    for (const m of this.meshes) m.end();
    this.frame = null;
  }

  private drawSlot(i: number, frame: BodyFrame): void {
    const m = this.draw(this.prey.objects[i], frame);
    if (m < 0) return;
    this.drawnMesh[i] = m;
    this.drawnIndex[i] = this.meshes[m].count - 1;
  }

  /** Draw a body in the mesh for its shape and size on screen; returns which mesh, or -1 if there was no room. */
  private draw(body: Body, frame: BodyFrame): number {
    const pixels = body.radius / frame.view.unitsPerPixel;
    let m = body.round ? SPHERE : pixels >= PREY.lowDetailPixels ? ROCK : pixels >= PREY.tinyDetailPixels ? ROCK_LOW : ROCK_TINY;
    // A full mesh hands over to the next coarser one.
    while (m > ROCK_TINY && m !== SPHERE && this.meshes[m].full) m--;
    return this.meshes[m].add(body, frame) < 0 ? -1 : m;
  }
}
