import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DISK, PREY, SPAGHETTI } from '../config';
import { canSwallow, sizeWeight, type Body } from '../sim/body.ts';
import { lerp, smooth, smoothstep } from '../sim/math.ts';
import { hash01 } from '../sim/rng.ts';
import type { World } from '../sim/World.ts';
import type { FieldSight } from '../net/ArenaMirror.ts';
import { createPreyMaterial } from './preyMaterial';

/** What the body renderers need for one frame. */
export interface BodyFrame {
  /** The world drawn: the offline arena, or online the client's mirror of the room. */
  world: World;
  /** Which field layers and cells may be drawn (online: only what the server keeps in sync), or null for all. */
  sight: FieldSight | null;
  /** 0..1: how far this frame is between the last two simulation steps. */
  alpha: number;
  /** Game seconds since the last frame, and since the renderers started (spin and tail animation). */
  dt: number;
  time: number;
  /**
   * The holes that can eat, as drawn this frame (the local one first): bodies stretch toward the nearest one that can
   * swallow them, and the shader winds a body around the hole it stretches toward or falls into.
   */
  readonly holes: readonly DrawnHole[];
  /** What the camera sees on the play plane (see GameCamera.groundView). */
  readonly view: GroundView;
}

/** A hole as drawn this frame (centre and gameplay radius). */
export interface DrawnHole {
  x: number;
  z: number;
  radius: number;
}

/**
 * The camera's footprint on the play plane: a trapezoid (the camera looks toward -z, so the bottom of the screen
 * is the near edge at the larger z) and a circle around it for coarse queries, plus the world size of a pixel at
 * the focus.
 */
export interface GroundView {
  x: number;
  z: number;
  radius: number;
  unitsPerPixel: number;
  nearZ: number;
  farZ: number;
  nearHalf: number;
  farHalf: number;
}

/** True if a circle of radius r at (x, z) is (at least partly) inside the camera's footprint. */
export function inView(view: GroundView, x: number, z: number, r: number): boolean {
  if (z > view.nearZ + r || z < view.farZ - r) return false;
  const span = view.nearZ - view.farZ;
  const t = span > 1e-9 ? Math.min(1, Math.max(0, (view.nearZ - z) / span)) : 0;
  return Math.abs(x - view.x) < view.nearHalf + (view.farHalf - view.nearHalf) * t + r;
}

/** Where the hole eating `obj` is drawn this frame, into `out` (the body's own position if that hole is gone). */
export function eaterPosition(frame: BodyFrame, obj: Body, out: THREE.Vector3): THREE.Vector3 {
  const hole = frame.world.hole(obj.eaterId);
  if (!hole) return out.set(obj.position.x, 0, obj.position.z);
  return out.set(lerp(hole.prevX, hole.position.x, frame.alpha), 0, lerp(hole.prevZ, hole.position.z, frame.alpha));
}

/** Infall progress (0..1) of an eating body as drawn this frame. */
export function drawnEatProgress(obj: Body, alpha: number): number {
  return Math.min(1, lerp(obj.prevEat, obj.eatProgress, alpha));
}

/** Tidal stretch of an edible body whose surface is `gap` hole radii from the core's edge (1 = none). */
function approachStretch(gap: number, objRadius: number, holeRadius: number): number {
  const k = Math.min(1, Math.max(0, 1 - gap / SPAGHETTI.onsetGap));
  return 1 + (SPAGHETTI.approachStretch - 1) * k * k * sizeWeight(objRadius, holeRadius);
}

const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const tmpPos = new THREE.Vector3();
const tmpMat = new THREE.Matrix4();
const tmpOffset = new THREE.Vector3();
const tmpAxis = new THREE.Vector3();
const tmpColor = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

export type PreyShape = 'rock' | 'rockLow' | 'rockTiny' | 'sphere';

/**
 * Lumpy rocks or smooth spheres drawn as one InstancedMesh with tidal stretching (spaghettification): edible
 * objects stretch toward the hole as it gets close, and eaten ones fall in, stretching into a thin spiralling
 * stream that drains into the core (see preySpaghettify.pars.vert.glsl). Filled afresh every frame from whatever
 * is in view (`begin`, `add` per body, `end`), up to a fixed capacity: everything about an instance (colour, spin,
 * stretch) is worked out from the body's sim state, its seed and the time, so nothing is kept per instance.
 * Used by the arena's bodies and grains, the comet nuclei and debris.
 */
export class PreyMesh {
  readonly mesh: THREE.InstancedMesh;
  readonly capacity: number;
  /** Instances written this frame so far. */
  count = 0;
  /** Per instance: direction from the hole (x, z), stretch factor, curl. */
  private readonly stretchAttr: THREE.InstancedBufferAttribute;
  /** Per instance: the hole it stretches toward (x, z) and that hole's core radius. */
  private readonly holeAttr: THREE.InstancedBufferAttribute;
  /** Per instance: tidal heating glow 0..1. */
  private readonly glowAttr: THREE.InstancedBufferAttribute;
  /** Per instance: heat of the body itself 0..1 (shed debris). */
  private readonly heatAttr: THREE.InstancedBufferAttribute;

  constructor(capacity: number, shape: PreyShape = 'rock') {
    this.capacity = capacity;
    const detail = shape === 'rockTiny' ? PREY.meshDetailTiny : shape === 'rockLow' ? PREY.meshDetailLow : PREY.meshDetail;
    const geometry = shape === 'sphere' ? createSphereGeometry() : createRockGeometry(detail);
    this.stretchAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.stretchAttr.setUsage(THREE.DynamicDrawUsage);
    this.holeAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.holeAttr.setUsage(THREE.DynamicDrawUsage);
    this.glowAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.glowAttr.setUsage(THREE.DynamicDrawUsage);
    this.heatAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.heatAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aStretch', this.stretchAttr);
    geometry.setAttribute('aHole', this.holeAttr);
    geometry.setAttribute('aGlow', this.glowAttr);
    geometry.setAttribute('aHeat', this.heatAttr);

    this.mesh = new THREE.InstancedMesh(geometry, createPreyMaterial(shape === 'sphere'), capacity);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Per-instance colour from the start, so the shader never recompiles when the first body is drawn.
    this.mesh.setColorAt(0, tmpColor.setRGB(1, 1, 1));
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
  }

  get full(): boolean {
    return this.count >= this.capacity;
  }

  /** Start a frame: no instances yet. */
  begin(): void {
    this.count = 0;
  }

  /**
   * Add a body as it stands between the last two steps; `heat` is its own glow (debris). Returns its instance
   * index, or -1 when the mesh is full.
   */
  add(obj: Body, frame: BodyFrame, heat = 0): number {
    if (this.count >= this.capacity) return -1;
    const i = this.count++;
    const seed = obj.seed;
    let scale = obj.radius * smooth(obj.appear);
    let stretch = 1;
    let curl = 0;
    let glow = 0;
    const attr = this.stretchAttr.array as Float32Array;
    const hAttr = this.holeAttr.array as Float32Array;

    if (obj.state === 'eating') {
      // Infall: the distance to the hole shrinks slowly then plunges, while the object swings around the hole with
      // the disk's spin. Stretch, curl and glow build up on the way in (from the stretch it had on approach, at
      // the moment it was eaten), and the last part of the infall drains it into the core.
      const t = drawnEatProgress(obj, frame.alpha);
      const fall = t ** SPAGHETTI.accelPower;
      tmpOffset.set(obj.eatOffset.x, 0, obj.eatOffset.z).applyAxisAngle(UP, DISK.spin * SPAGHETTI.swirl * fall);
      setDirection(attr, i, tmpOffset.x, tmpOffset.z);
      eaterPosition(frame, obj, tmpPos).addScaledVector(tmpOffset, 1 - fall);
      const eater = frame.world.hole(obj.eaterId);
      const er = eater ? eater.radius : obj.radius;
      setHole(hAttr, i, tmpPos.x - tmpOffset.x * (1 - fall), tmpPos.z - tmpOffset.z * (1 - fall), er);
      const from = approachStretch((Math.hypot(obj.eatOffset.x, obj.eatOffset.z) - er - obj.radius) / er, obj.radius, er);
      const build = 1 - (1 - t) * (1 - t);
      stretch = lerp(from, 1 + (SPAGHETTI.maxStretch - 1) * obj.infallWeight, build);
      curl = DISK.spin * SPAGHETTI.curl * obj.infallWeight * build;
      glow = t;
      scale *= 1 - smoothstep(SPAGHETTI.drainStart, 1, t);
    } else {
      tmpPos.set(lerp(obj.prevX, obj.position.x, frame.alpha), 0, lerp(obj.prevZ, obj.position.z, frame.alpha));
      // Tidal stretch on approach, for edible objects only: toward the nearest hole that can swallow it.
      const holes = frame.holes;
      let best: DrawnHole | null = null;
      let bestGap = Infinity;
      for (let h = 0; h < holes.length; h++) {
        const hole = holes[h];
        if (!canSwallow(obj.radius, hole.radius)) continue;
        const dx = tmpPos.x - hole.x;
        const dz = tmpPos.z - hole.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const gap = (dist - hole.radius - obj.radius) / hole.radius;
        if (gap < bestGap) {
          bestGap = gap;
          best = hole;
        }
      }
      if (best && bestGap < SPAGHETTI.onsetGap) {
        setDirection(attr, i, tmpPos.x - best.x, tmpPos.z - best.z);
        stretch = approachStretch(bestGap, obj.radius, best.radius);
        setHole(hAttr, i, best.x, best.z, best.radius);
      } else {
        // Nothing to stretch toward: any hole will do for the shader (it is only used when the stretch is not 1).
        const any = holes.length > 0 ? holes[0] : null;
        setDirection(attr, i, 1, 0);
        setHole(hAttr, i, any ? any.x : 0, any ? any.z : 0, any ? any.radius : 1);
      }
    }

    attr[i * 4 + 2] = stretch;
    attr[i * 4 + 3] = curl;
    (this.glowAttr.array as Float32Array)[i] = glow;
    (this.heatAttr.array as Float32Array)[i] = heat;

    // Look from the seed: colour within the class's ranges, a spin axis, a phase and a speed.
    const { hue, sat, light } = obj.color;
    tmpColor.setHSL(lerp(hue[0], hue[1], hash01(seed, 0)), lerp(sat[0], sat[1], hash01(seed, 1)), lerp(light[0], light[1], hash01(seed, 2)));
    this.mesh.setColorAt(i, tmpColor);
    tmpAxis.set(hash01(seed, 3) - 0.5, hash01(seed, 4) - 0.5, hash01(seed, 5) - 0.5);
    if (tmpAxis.lengthSq() < 1e-4) tmpAxis.set(0, 1, 0);
    tmpAxis.normalize();
    const angle = hash01(seed, 6) * Math.PI * 2 + (hash01(seed, 7) * 2 - 1) * PREY.spinSpeed * frame.time;
    tmpQuat.setFromAxisAngle(tmpAxis, angle);
    tmpScale.setScalar(Math.max(scale, 1e-4));
    tmpMat.compose(tmpPos, tmpQuat, tmpScale);
    this.mesh.setMatrixAt(i, tmpMat);
    return i;
  }

  /** End a frame: draw the instances written and flag them for upload. */
  end(): void {
    this.mesh.count = this.count;
    if (this.count === 0) return;
    this.mesh.instanceMatrix.clearUpdateRanges();
    this.mesh.instanceMatrix.addUpdateRange(0, this.count * 16);
    this.mesh.instanceMatrix.needsUpdate = true;
    const color = this.mesh.instanceColor!;
    color.clearUpdateRanges();
    color.addUpdateRange(0, this.count * 3);
    color.needsUpdate = true;
    for (const [attr, size] of [
      [this.stretchAttr, 4],
      [this.holeAttr, 3],
      [this.glowAttr, 1],
      [this.heatAttr, 1],
    ] as const) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, this.count * size);
      attr.needsUpdate = true;
    }
  }
}

function setHole(attr: Float32Array, i: number, x: number, z: number, radius: number): void {
  attr[i * 3] = x;
  attr[i * 3 + 1] = z;
  attr[i * 3 + 2] = radius;
}

/** The unit direction from the hole to the object (any direction when they are on top of each other). */
function setDirection(attr: Float32Array, i: number, dx: number, dz: number): void {
  const len = Math.sqrt(dx * dx + dz * dz);
  attr[i * 4] = len < 1e-6 ? 1 : dx / len;
  attr[i * 4 + 1] = len < 1e-6 ? 0 : dz / len;
}

/** Lumpy unit rock. Displacement is a pure function of position, so duplicated vertices stay welded. */
function createRockGeometry(detail: number): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const n =
      Math.sin(v.x * 3.1 + 1.3) * Math.sin(v.y * 2.7 + 0.4) * Math.sin(v.z * 3.3 + 2.1) +
      0.5 * Math.sin(v.x * 7.3 + v.y * 5.1 + 0.7) * Math.sin(v.z * 6.1 + v.x * 2.3);
    v.multiplyScalar(1 + PREY.roughness * n);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Smooth unit icosphere, indexed so each vertex is shaded once per instance. Normals point straight out. */
function createSphereGeometry(): THREE.BufferGeometry {
  const ico = new THREE.IcosahedronGeometry(1, PREY.sphereDetail);
  ico.deleteAttribute('normal');
  ico.deleteAttribute('uv');
  const geo = mergeVertices(ico);
  ico.dispose();
  geo.setAttribute('normal', geo.attributes.position.clone());
  return geo;
}
