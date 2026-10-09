import * as THREE from 'three';
import { SHED_BURST } from '../config';
import { OVERLAY_LAYER } from '../render/layers';
import vert from '../shaders/shedBurst.vert.glsl';
import frag from '../shaders/shedBurst.frag.glsl';

/**
 * Glowing fragments thrown off the disk when a hit sheds mass. A fixed pool of points simulated on the CPU
 * (no allocations per frame). Drawn with the hole's own parts after the lens, so they are never bent.
 */
export class ShedBurst {
  readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly lifeArr: Float32Array;
  private readonly sizeArr: Float32Array;
  private readonly vel: Float32Array;
  private readonly age: Float32Array;
  private readonly maxAge: Float32Array;
  private readonly posAttr: THREE.BufferAttribute;
  private readonly lifeAttr: THREE.BufferAttribute;
  private readonly sizeAttr: THREE.BufferAttribute;
  private readonly pointScale = { value: 1 };
  private next = 0;
  /** Particles alive right now (tests). */
  live = 0;

  constructor() {
    const n = SHED_BURST.poolSize;
    this.positions = new Float32Array(n * 3);
    this.lifeArr = new Float32Array(n);
    this.sizeArr = new Float32Array(n);
    this.vel = new Float32Array(n * 2);
    this.age = new Float32Array(n);
    this.maxAge = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.lifeAttr = new THREE.BufferAttribute(this.lifeArr, 1).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.sizeArr, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aLife', this.lifeAttr);
    geo.setAttribute('aSize', this.sizeAttr);
    const material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        uPointScale: this.pointScale,
        uColor: { value: new THREE.Color(SHED_BURST.color).multiplyScalar(SHED_BURST.intensity) },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    this.points = new THREE.Points(geo, material);
    this.points.frustumCulled = false;
    this.points.layers.set(OVERLAY_LAYER);
  }

  /** Pixels per world unit at distance 1, from the render height and vertical field of view (degrees). */
  setViewport(renderHeight: number, fovDegrees: number): void {
    this.pointScale.value = renderHeight / (2 * Math.tan(THREE.MathUtils.degToRad(fovDegrees) / 2));
  }

  /**
   * Throw fragments off a hole of radius `holeRadius` at (x, z). (nx, nz) is the unit direction the hole is
   * knocked; the spray leans that way.
   */
  emit(x: number, z: number, nx: number, nz: number, holeRadius: number): void {
    const S = SHED_BURST;
    for (let k = 0; k < S.perHit; k++) {
      const i = this.next;
      this.next = (this.next + 1) % S.poolSize;
      const angle = Math.random() * Math.PI * 2;
      const cx = Math.cos(angle);
      const cz = Math.sin(angle);
      // Start on the disk around the core, fly outward, leaning toward the knock direction.
      const r = holeRadius * (1.1 + Math.random() * 1.6);
      const speed = holeRadius * (S.speedMin + Math.random() * (S.speedMax - S.speedMin));
      this.positions[i * 3] = x + cx * r;
      this.positions[i * 3 + 1] = holeRadius * 0.05;
      this.positions[i * 3 + 2] = z + cz * r;
      this.vel[i * 2] = (cx + nx * 0.8) * speed;
      this.vel[i * 2 + 1] = (cz + nz * 0.8) * speed;
      this.age[i] = 0;
      this.maxAge[i] = S.lifeMin + Math.random() * (S.lifeMax - S.lifeMin);
      this.sizeArr[i] = holeRadius * (S.sizeMin + Math.random() * (S.sizeMax - S.sizeMin));
      this.lifeArr[i] = 1;
    }
    this.sizeAttr.needsUpdate = true;
  }

  update(dt: number): void {
    const drag = Math.exp(-SHED_BURST.drag * dt);
    let live = 0;
    for (let i = 0; i < SHED_BURST.poolSize; i++) {
      if (this.lifeArr[i] <= 0) continue;
      this.age[i] += dt;
      const life = 1 - this.age[i] / this.maxAge[i];
      if (life <= 0) {
        this.lifeArr[i] = 0;
        continue;
      }
      live++;
      this.lifeArr[i] = life;
      this.positions[i * 3] += this.vel[i * 2] * dt;
      this.positions[i * 3 + 2] += this.vel[i * 2 + 1] * dt;
      this.vel[i * 2] *= drag;
      this.vel[i * 2 + 1] *= drag;
    }
    this.live = live;
    this.posAttr.needsUpdate = true;
    this.lifeAttr.needsUpdate = true;
  }

  reset(): void {
    this.lifeArr.fill(0);
    this.live = 0;
    this.lifeAttr.needsUpdate = true;
  }
}
