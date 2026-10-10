import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { LENSING, QUALITY } from '../config';
import type { GpuTimer } from './GpuTimer';
import vertexShader from '../shaders/lensing.vert.glsl';
import fragmentShader from '../shaders/lensing.frag.glsl';
import { CORE_LAYER, OVERLAY_LAYER } from './layers';
import { lensUniforms } from './lensUniforms';

/** What the lens is centred on (the player). */
export interface LensTarget {
  readonly position: THREE.Vector3;
  readonly radius: number;
}

const WORLD_UP = new THREE.Vector3(0, 1, 0);

/** Most extra lenses the shader bends the picture around, besides the main one (see MAX_EXTRA in lensing.frag.glsl). */
export const MAX_EXTRA_LENSES = 2;

/**
 * Screen-space gravitational lens. Reads the scene colour and depth (the read buffer needs a
 * DepthTexture), writes the bent colour and bent depth to the write buffer, then draws the hole's
 * own parts (core, disk, photon ring) on top, depth-tested against the bent scene. So the core is
 * never bent, and CorePass still finds a valid scene depth on the read buffer after the swap.
 *
 * Besides the main lens (the local hole, at the centre of the picture) up to MAX_EXTRA_LENSES other holes can bend the
 * picture too (`extras`, chosen by the caller each frame): their deflections add up. Other holes are drawn like the main
 * one (core, disk, photon ring on top), they just do not all get a lens.
 *
 * Contract for the scene (layer 0): alpha is a mask. Play-plane objects (prey) write alpha 1, the
 * clear is alpha 0, and background or additive effects must leave alpha untouched (see Starfield),
 * or the lens treats them as play-plane objects.
 */
export class LensingPass extends Pass {
  /** Lens centre in uv (0..1, y up) as of the last frame. */
  readonly centre = new THREE.Vector2(0.5, 0.5);
  /** On-screen core radius as a fraction of the screen height, as of the last frame. */
  coreRadius = 0;
  /** Set by Renderer.enableProfiling. */
  timer: GpuTimer | null = null;
  /** Other holes that bend the picture this frame (at most MAX_EXTRA_LENSES; the rest are ignored). */
  extras: readonly LensTarget[] = [];
  private readonly material: THREE.ShaderMaterial;
  private readonly quad: FullScreenQuad;
  private readonly centreNdc = new THREE.Vector3();
  private readonly extraCentre: THREE.Vector2[] = [];
  private readonly extraUvToLens: THREE.Vector2[] = [];
  private readonly extraView: THREE.Vector3[] = [];
  private readonly extraRadius: number[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly target: LensTarget,
  ) {
    super();
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        ...lensUniforms,
        tColor: { value: null },
        tDepth: { value: null },
        uCentre: { value: new THREE.Vector2(0.5, 0.5) },
        uUvToLens: { value: new THREE.Vector2(1, 1) },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uSampleZone: { value: 0 },
        uLensSamples: { value: 1 },
        uTanHalfFov: { value: new THREE.Vector2(1, 1) },
        uPlaneNormal: { value: new THREE.Vector3(0, 1, 0) },
        uLensView: { value: new THREE.Vector3(0, 0, -1) },
        uPlayerRadius: { value: 1 },
        uExtraCount: { value: 0 },
        uExtraCentre: { value: [] as THREE.Vector2[] },
        uExtraUvToLens: { value: [] as THREE.Vector2[] },
        uExtraView: { value: [] as THREE.Vector3[] },
        uExtraRadius: { value: [] as number[] },
      },
      // The quad writes the bent scene depth through gl_FragDepth.
      depthTest: true,
      depthWrite: true,
      depthFunc: THREE.AlwaysDepth,
      blending: THREE.NoBlending,
    });
    for (let i = 0; i < MAX_EXTRA_LENSES; i++) {
      this.extraCentre.push(new THREE.Vector2(0.5, 0.5));
      this.extraUvToLens.push(new THREE.Vector2(1, 1));
      this.extraView.push(new THREE.Vector3(0, 0, -1));
      this.extraRadius.push(1);
    }
    const u = this.material.uniforms;
    u.uExtraCentre.value = this.extraCentre;
    u.uExtraUvToLens.value = this.extraUvToLens;
    u.uExtraView.value = this.extraView;
    u.uExtraRadius.value = this.extraRadius;
    this.quad = new FullScreenQuad(this.material);
    this.setSamples(QUALITY.levels[0].lensSamples);
  }

  /**
   * Samples per pixel near the Einstein ring (a uniform, so changing it never recompiles the shader).
   * 0 turns lensing off; the disk stops bending too.
   */
  setSamples(samples: number): void {
    lensUniforms.uLensOn.value = samples > 0 ? 1 : 0;
    this.material.uniforms.uLensSamples.value = THREE.MathUtils.clamp(Math.round(samples), 1, 4);
  }

  setSize(width: number, height: number): void {
    this.material.uniforms.uTexel.value.set(1 / width, 1 / height);
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    const uniforms = this.material.uniforms;
    uniforms.tColor.value = readBuffer.texture;
    uniforms.tDepth.value = readBuffer.depthTexture;
    this.updateLens();

    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.timer?.begin('lens');
    this.quad.render(renderer);
    this.timer?.begin('hole');

    const mask = this.camera.layers.mask;
    this.camera.layers.set(CORE_LAYER);
    this.camera.layers.enable(OVERLAY_LAYER);
    renderer.render(this.scene, this.camera);
    this.timer?.end();
    this.camera.layers.mask = mask;
    renderer.autoClear = autoClear;
  }

  dispose(): void {
    this.material.dispose();
    this.quad.dispose();
  }

  /** Lens centre and core radius from projecting the target, plus the play plane in view space. */
  private updateLens(): void {
    const camera = this.camera;
    const uniforms = this.material.uniforms;
    camera.updateMatrixWorld();

    this.project(this.target, this.centre, uniforms.uUvToLens.value, uniforms.uLensView.value);
    this.coreRadius = this.lastCoreRadius;
    uniforms.uCentre.value.copy(this.centre);
    const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / camera.zoom;
    uniforms.uTanHalfFov.value.set(tanHalfFov * camera.aspect, tanHalfFov);
    uniforms.uPlaneNormal.value.copy(WORLD_UP).transformDirection(camera.matrixWorldInverse);
    uniforms.uPlayerRadius.value = this.target.radius;
    uniforms.uSampleZone.value = LENSING.sampleZone * lensUniforms.uLensEinstein.value;

    const count = Math.min(this.extras.length, MAX_EXTRA_LENSES);
    uniforms.uExtraCount.value = count;
    for (let i = 0; i < count; i++) {
      this.project(this.extras[i], this.extraCentre[i], this.extraUvToLens[i], this.extraView[i]);
      this.extraRadius[i] = this.extras[i].radius;
    }
  }

  private lastCoreRadius = 0;

  /** Where a lens target is on screen (uv centre), its core radius as a fraction of the screen height, the scale from a uv offset to its core radii, and its centre in view space. */
  private project(target: LensTarget, centre: THREE.Vector2, uvToLens: THREE.Vector2, view: THREE.Vector3): void {
    const camera = this.camera;
    const centreView = view.copy(target.position).applyMatrix4(camera.matrixWorldInverse);
    const ndc = this.centreNdc.copy(centreView).applyMatrix4(camera.projectionMatrix);
    centre.set(ndc.x * 0.5 + 0.5, ndc.y * 0.5 + 0.5);
    // Angular radius of the core sphere's silhouette, as a fraction of the screen height.
    const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / camera.zoom;
    const sinCore = Math.min(target.radius / centreView.length(), 0.99);
    const coreRadius = (0.5 * sinCore) / Math.sqrt(1 - sinCore * sinCore) / tanHalfFov;
    this.lastCoreRadius = coreRadius;
    uvToLens.set(camera.aspect / coreRadius, 1 / coreRadius);
  }
}
