import * as THREE from 'three';
import { DISK, PREY, SPAGHETTI } from '../config';
import type { Player } from '../player/Player';
import { createPreyMaterial, type PreyUniforms } from './preyMaterial';

export type PreyState = 'alive' | 'eating';

/** One pooled prey object (also a comet nucleus). Pools never grow or shrink; entries are reused. */
export interface PreyObject {
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  radius: number;
  mass: number;
  /** Name of the tier-table class this object was drawn from, e.g. "asteroid". */
  className: string;
  state: PreyState;
  /** 0..1 scale-in after (re)spawning. */
  appear: number;
  /** 0..1 progress of the infall after being eaten. */
  eatProgress: number;
  /** Infall duration in seconds (bigger prey fall in more slowly). */
  infallTime: number;
  /** Offset from the hole when eaten. The infall follows the hole if it moves. */
  readonly eatOffset: THREE.Vector3;
  /** Size weight (0..1) fixed when eaten: scales the stretch and curl of the infall. */
  infallWeight: number;
  /** Stretch factor at the moment it was eaten, so the infall continues from the approach stretch. */
  stretchFrom: number;
  /** Current tidal stretch factor (1 = none), as sent to the GPU. */
  stretch: number;
  /** Last unit direction from the hole to the object on the play plane (kept when the distance is ~0). */
  dirX: number;
  dirZ: number;
  readonly spinAxis: THREE.Vector3;
  spinAngle: number;
  spinSpeed: number;
}

export function createPreyObject(): PreyObject {
  return {
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    radius: 1,
    mass: 1,
    className: '',
    state: 'alive',
    appear: 1,
    eatProgress: 0,
    infallTime: 1,
    eatOffset: new THREE.Vector3(),
    infallWeight: 0,
    stretchFrom: 1,
    stretch: 1,
    dirX: 1,
    dirZ: 0,
    spinAxis: new THREE.Vector3(0, 1, 0),
    spinAngle: 0,
    spinSpeed: 0,
  };
}

/** True if a hole of this radius can eat an object of the given radius. */
export function canSwallow(objRadius: number, holeRadius: number): boolean {
  return objRadius < holeRadius * PREY.edibleRatio;
}

/** 0..1: how big an edible object is for the hole. Bigger prey spaghettify harder and fall in more slowly. */
export function sizeWeight(objRadius: number, holeRadius: number): number {
  return Math.min(1, objRadius / (holeRadius * PREY.edibleRatio)) ** SPAGHETTI.sizePower;
}

/** Eat on contact: credit the mass and start the infall. */
export function beginInfall(obj: PreyObject, player: Player): void {
  obj.state = 'eating';
  obj.eatProgress = 0;
  obj.eatOffset.subVectors(obj.position, player.position);
  obj.infallWeight = sizeWeight(obj.radius, player.radius);
  obj.infallTime = lerp(SPAGHETTI.infallTimeMin, SPAGHETTI.infallTimeMax, obj.infallWeight);
  obj.stretchFrom = obj.stretch;
  player.eat(obj.mass, { name: obj.className, radius: obj.radius });
}

/** Random unit spin axis, angle and speed. */
export function randomSpin(obj: PreyObject): void {
  obj.spinAxis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
  if (obj.spinAxis.lengthSq() < 1e-4) obj.spinAxis.set(0, 1, 0);
  obj.spinAxis.normalize();
  obj.spinAngle = Math.random() * Math.PI * 2;
  obj.spinSpeed = (Math.random() * 2 - 1) * PREY.spinSpeed;
}

const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const tmpPos = new THREE.Vector3();
const tmpMat = new THREE.Matrix4();
const tmpOffset = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const ZERO_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * Lumpy rocks drawn as one InstancedMesh with tidal stretching (spaghettification): edible objects stretch
 * toward the hole as it gets close, and eaten ones fall in, stretching into a thin spiralling stream that
 * drains into the core (see preySpaghettify.pars.vert.glsl). Used by the prey field and the comet nuclei.
 */
export class PreyMesh {
  readonly mesh: THREE.InstancedMesh;
  /** Per instance: direction from the hole (x, z), stretch factor, curl. */
  private readonly stretchAttr: THREE.InstancedBufferAttribute;
  /** Per instance: tidal heating glow 0..1. */
  private readonly glowAttr: THREE.InstancedBufferAttribute;
  private readonly uniforms: PreyUniforms;

  constructor(capacity: number) {
    const geometry = createRockGeometry();
    this.stretchAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.stretchAttr.setUsage(THREE.DynamicDrawUsage);
    this.glowAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.glowAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aStretch', this.stretchAttr);
    geometry.setAttribute('aGlow', this.glowAttr);

    const { material, uniforms } = createPreyMaterial();
    this.uniforms = uniforms;
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }

  /** Once per frame, before writing instances. */
  setHole(player: Player): void {
    this.uniforms.uHole.value.set(player.position.x, player.position.z, player.radius);
  }

  setColor(i: number, color: THREE.Color): void {
    this.mesh.setColorAt(i, color);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Hide slot i (an idle pool entry). */
  hide(i: number): void {
    this.mesh.setMatrixAt(i, ZERO_MATRIX);
  }

  /** Flag the per-instance buffers for upload after writing. */
  commit(): void {
    this.mesh.instanceMatrix.needsUpdate = true;
    this.stretchAttr.needsUpdate = true;
    this.glowAttr.needsUpdate = true;
  }

  /** Transform, stretch and glow of slot i from the object's state. */
  write(i: number, obj: PreyObject, player: Player): void {
    let scale = obj.radius * smooth(obj.appear);
    let stretch = 1;
    let curl = 0;
    let glow = 0;

    if (obj.state === 'eating') {
      // Infall: the distance to the hole shrinks slowly then plunges, while the object swings
      // around the hole with the disk's spin. Stretch, curl and glow build up on the way in,
      // and the last part of the infall drains it into the core.
      const t = Math.min(obj.eatProgress, 1);
      const fall = t ** SPAGHETTI.accelPower;
      tmpOffset.copy(obj.eatOffset).applyAxisAngle(UP, DISK.spin * SPAGHETTI.swirl * fall);
      setDirection(obj, tmpOffset.x, tmpOffset.z);
      tmpPos.copy(player.position).addScaledVector(tmpOffset, 1 - fall);
      const build = 1 - (1 - t) * (1 - t);
      stretch = lerp(obj.stretchFrom, 1 + (SPAGHETTI.maxStretch - 1) * obj.infallWeight, build);
      curl = DISK.spin * SPAGHETTI.curl * obj.infallWeight * build;
      glow = t;
      scale *= 1 - smoothstep(SPAGHETTI.drainStart, 1, t);
    } else {
      tmpPos.copy(obj.position);
      const dx = obj.position.x - player.position.x;
      const dz = obj.position.z - player.position.z;
      setDirection(obj, dx, dz);
      // Tidal stretch on approach, for edible objects only.
      if (canSwallow(obj.radius, player.radius)) {
        const gap = (Math.sqrt(dx * dx + dz * dz) - player.radius - obj.radius) / player.radius;
        const k = Math.min(1, Math.max(0, 1 - gap / SPAGHETTI.onsetGap));
        stretch = 1 + (SPAGHETTI.approachStretch - 1) * k * k * sizeWeight(obj.radius, player.radius);
      }
    }

    obj.stretch = stretch;
    this.stretchAttr.setXYZW(i, obj.dirX, obj.dirZ, stretch, curl);
    this.glowAttr.setX(i, glow);

    tmpQuat.setFromAxisAngle(obj.spinAxis, obj.spinAngle);
    tmpScale.setScalar(Math.max(scale, 1e-4));
    tmpMat.compose(tmpPos, tmpQuat, tmpScale);
    this.mesh.setMatrixAt(i, tmpMat);
  }
}

/** Remember the direction from the hole to the object, unless they are on top of each other. */
function setDirection(obj: PreyObject, dx: number, dz: number): void {
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len < 1e-6) return;
  obj.dirX = dx / len;
  obj.dirZ = dz / len;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  return smooth(Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0))));
}

export function logUniform(min: number, max: number): number {
  return Math.exp(lerp(Math.log(min), Math.log(max), Math.random()));
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
