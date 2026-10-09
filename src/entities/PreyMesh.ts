import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DISK, PREY, SPAGHETTI } from '../config';
import { canSwallow, sizeWeight, type Body } from '../sim/body.ts';
import { lerp, smooth, smoothstep } from '../sim/math.ts';
import { hash01 } from '../sim/rng.ts';
import type { World } from '../sim/World.ts';
import { createPreyMaterial, type PreyUniforms } from './preyMaterial';

/** What the body renderers need for one frame. */
export interface BodyFrame {
  readonly world: World;
  /** 0..1: how far this frame is between the last two simulation steps. */
  alpha: number;
  /** Game seconds since the last frame (spin and tail animation). */
  dt: number;
  /** The rendered focus hole: approach stretch and the shader's hole uniform follow it. */
  readonly hole: { readonly position: THREE.Vector3; readonly radius: number };
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

const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const tmpPos = new THREE.Vector3();
const tmpMat = new THREE.Matrix4();
const tmpOffset = new THREE.Vector3();
const tmpAxis = new THREE.Vector3();
const tmpColor = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const ZERO_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

/** Last state a slot was drawn in, to catch the moment a body is eaten. */
const NONE = 0;
const ALIVE = 1;
const EATING = 2;

export type PreyShape = 'rock' | 'sphere';

/**
 * Lumpy rocks or smooth spheres drawn as one InstancedMesh with tidal stretching (spaghettification): edible
 * objects stretch toward the hole as it gets close, and eaten ones fall in, stretching into a thin spiralling
 * stream that drains into the core (see preySpaghettify.pars.vert.glsl). Used by the prey field, the comet
 * nuclei and debris. Reads sim bodies; the look (colour, spin) comes from each body's seed.
 */
export class PreyMesh {
  readonly mesh: THREE.InstancedMesh;
  /** Per instance: direction from the hole (x, z), stretch factor, curl. */
  private readonly stretchAttr: THREE.InstancedBufferAttribute;
  /** Per instance: tidal heating glow 0..1. */
  private readonly glowAttr: THREE.InstancedBufferAttribute;
  /** Per instance: heat of the body itself 0..1 (shed debris), zero unless set. */
  private readonly heatAttr: THREE.InstancedBufferAttribute;
  private readonly uniforms: PreyUniforms;
  /** Per slot: the body generation it was last drawn for, its state then and its stretch then. */
  private readonly gens: Float64Array;
  private readonly states: Uint8Array;
  private readonly stretch: Float32Array;
  /** Per slot: stretch at the moment it was eaten, so the infall continues from the approach stretch. */
  private readonly stretchFrom: Float32Array;
  /** Per slot: spin axis (x, y, z), angle and speed. */
  private readonly spin: Float32Array;
  private holeX = 0;
  private holeZ = 0;
  private holeRadius = 1;

  constructor(capacity: number, shape: PreyShape = 'rock') {
    const geometry = shape === 'sphere' ? createSphereGeometry() : createRockGeometry();
    this.stretchAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.stretchAttr.setUsage(THREE.DynamicDrawUsage);
    this.glowAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.glowAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aStretch', this.stretchAttr);
    this.heatAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.heatAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aGlow', this.glowAttr);
    geometry.setAttribute('aHeat', this.heatAttr);

    const { material, uniforms } = createPreyMaterial(shape === 'sphere');
    this.uniforms = uniforms;
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Per-instance colour from the start, so the shader never recompiles when the first body is drawn.
    this.mesh.setColorAt(0, tmpColor.setRGB(1, 1, 1));

    this.gens = new Float64Array(capacity).fill(-1);
    this.states = new Uint8Array(capacity);
    this.stretch = new Float32Array(capacity).fill(1);
    this.stretchFrom = new Float32Array(capacity).fill(1);
    this.spin = new Float32Array(capacity * 5);
    for (let i = 0; i < capacity; i++) this.stretchAttr.setX(i, 1);
  }

  /** Once per frame, before writing instances: the hole the approach stretch and the shader follow. */
  setHole(frame: BodyFrame): void {
    const { position, radius } = frame.hole;
    this.holeX = position.x;
    this.holeZ = position.z;
    this.holeRadius = radius;
    this.uniforms.uHole.value.set(position.x, position.z, radius);
  }

  /** Heat glow of slot i, 0..1 (flagged for upload by commit). */
  setHeat(i: number, heat: number): void {
    this.heatAttr.setX(i, heat);
  }

  /** Hide slot i (an idle pool entry, or one drawn by another mesh). */
  hide(i: number): void {
    this.mesh.setMatrixAt(i, ZERO_MATRIX);
  }

  /** Flag the per-instance buffers for upload after writing. */
  commit(): void {
    this.mesh.instanceMatrix.needsUpdate = true;
    this.stretchAttr.needsUpdate = true;
    this.glowAttr.needsUpdate = true;
    this.heatAttr.needsUpdate = true;
  }

  /** Transform, stretch and glow of slot i from the body's sim state, between the last two steps. */
  write(i: number, obj: Body, frame: BodyFrame): void {
    if (this.gens[i] !== obj.gen) this.adopt(i, obj);
    const s = i * 5;
    this.spin[s + 3] += this.spin[s + 4] * frame.dt;
    let scale = obj.radius * smooth(obj.appear);
    let stretch = 1;
    let curl = 0;
    let glow = 0;

    if (obj.state === 'eating') {
      if (this.states[i] !== EATING) this.stretchFrom[i] = this.states[i] === ALIVE ? this.stretch[i] : 1;
      this.states[i] = EATING;
      // Infall: the distance to the hole shrinks slowly then plunges, while the object swings
      // around the hole with the disk's spin. Stretch, curl and glow build up on the way in,
      // and the last part of the infall drains it into the core.
      const t = drawnEatProgress(obj, frame.alpha);
      const fall = t ** SPAGHETTI.accelPower;
      tmpOffset.set(obj.eatOffset.x, 0, obj.eatOffset.z).applyAxisAngle(UP, DISK.spin * SPAGHETTI.swirl * fall);
      this.setDirection(i, tmpOffset.x, tmpOffset.z);
      eaterPosition(frame, obj, tmpPos).addScaledVector(tmpOffset, 1 - fall);
      const build = 1 - (1 - t) * (1 - t);
      stretch = lerp(this.stretchFrom[i], 1 + (SPAGHETTI.maxStretch - 1) * obj.infallWeight, build);
      curl = DISK.spin * SPAGHETTI.curl * obj.infallWeight * build;
      glow = t;
      scale *= 1 - smoothstep(SPAGHETTI.drainStart, 1, t);
    } else {
      this.states[i] = ALIVE;
      tmpPos.set(lerp(obj.prevX, obj.position.x, frame.alpha), 0, lerp(obj.prevZ, obj.position.z, frame.alpha));
      const hr = this.holeRadius;
      const dx = tmpPos.x - this.holeX;
      const dz = tmpPos.z - this.holeZ;
      this.setDirection(i, dx, dz);
      // Tidal stretch on approach, for edible objects only.
      if (canSwallow(obj.radius, hr)) {
        const gap = (Math.sqrt(dx * dx + dz * dz) - hr - obj.radius) / hr;
        const k = Math.min(1, Math.max(0, 1 - gap / SPAGHETTI.onsetGap));
        stretch = 1 + (SPAGHETTI.approachStretch - 1) * k * k * sizeWeight(obj.radius, hr);
      }
    }

    this.stretch[i] = stretch;
    const attr = this.stretchAttr.array as Float32Array;
    attr[i * 4 + 2] = stretch;
    attr[i * 4 + 3] = curl;
    this.glowAttr.setX(i, glow);

    tmpAxis.set(this.spin[s], this.spin[s + 1], this.spin[s + 2]);
    tmpQuat.setFromAxisAngle(tmpAxis, this.spin[s + 3]);
    tmpScale.setScalar(Math.max(scale, 1e-4));
    tmpMat.compose(tmpPos, tmpQuat, tmpScale);
    this.mesh.setMatrixAt(i, tmpMat);
  }

  /** Slot i now draws a new body: colour and spin from its seed, no stretch history. */
  private adopt(i: number, obj: Body): void {
    this.gens[i] = obj.gen;
    this.states[i] = NONE;
    this.stretch[i] = 1;
    const seed = obj.seed;
    const { hue, sat, light } = obj.color;
    tmpColor.setHSL(lerp(hue[0], hue[1], hash01(seed, 0)), lerp(sat[0], sat[1], hash01(seed, 1)), lerp(light[0], light[1], hash01(seed, 2)));
    this.mesh.setColorAt(i, tmpColor);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    tmpAxis.set(hash01(seed, 3) - 0.5, hash01(seed, 4) - 0.5, hash01(seed, 5) - 0.5);
    if (tmpAxis.lengthSq() < 1e-4) tmpAxis.set(0, 1, 0);
    tmpAxis.normalize();
    const s = i * 5;
    this.spin[s] = tmpAxis.x;
    this.spin[s + 1] = tmpAxis.y;
    this.spin[s + 2] = tmpAxis.z;
    this.spin[s + 3] = hash01(seed, 6) * Math.PI * 2;
    this.spin[s + 4] = (hash01(seed, 7) * 2 - 1) * PREY.spinSpeed;
  }

  /** Remember the direction from the hole to the object, unless they are on top of each other. */
  private setDirection(i: number, dx: number, dz: number): void {
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 1e-6) return;
    const attr = this.stretchAttr.array as Float32Array;
    attr[i * 4] = dx / len;
    attr[i * 4 + 1] = dz / len;
  }
}

/** Lumpy unit rock. Displacement is a pure function of position, so duplicated vertices stay welded. */
function createRockGeometry(): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, PREY.meshDetail);
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
