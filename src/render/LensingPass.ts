import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { LENSING } from '../config';
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

/**
 * Screen-space gravitational lens. Reads the scene colour and depth (the read buffer needs a
 * DepthTexture), writes the bent colour and bent depth to the write buffer, then draws the hole's
 * own parts (core, disk, photon ring) on top, depth-tested against the bent scene. So the core is
 * never bent, and CorePass still finds a valid scene depth on the read buffer after the swap.
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
  private readonly material: THREE.ShaderMaterial;
  private readonly quad: FullScreenQuad;
  private readonly centreView = new THREE.Vector3();
  private readonly centreNdc = new THREE.Vector3();

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
        uTanHalfFov: { value: new THREE.Vector2(1, 1) },
        uPlaneNormal: { value: new THREE.Vector3(0, 1, 0) },
        uLensView: { value: new THREE.Vector3(0, 0, -1) },
        uPlayerRadius: { value: 1 },
      },
      defines: { LENS_SAMPLES: 1 },
      // The quad writes the bent scene depth through gl_FragDepth.
      depthTest: true,
      depthWrite: true,
      depthFunc: THREE.AlwaysDepth,
      blending: THREE.NoBlending,
    });
    this.quad = new FullScreenQuad(this.material);
    this.setQuality(LENSING.quality);
  }

  /** Index into LENSING.samples. The lowest level turns lensing off (the disk stops bending too). */
  setQuality(level: number): void {
    const samples = LENSING.samples[THREE.MathUtils.clamp(Math.round(level), 0, LENSING.samples.length - 1)];
    lensUniforms.uLensOn.value = samples > 0 ? 1 : 0;
    const perPixel = THREE.MathUtils.clamp(samples, 1, 4);
    if (this.material.defines.LENS_SAMPLES !== perPixel) {
      this.material.defines.LENS_SAMPLES = perPixel;
      this.material.needsUpdate = true;
    }
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
    this.quad.render(renderer);

    const mask = this.camera.layers.mask;
    this.camera.layers.set(CORE_LAYER);
    this.camera.layers.enable(OVERLAY_LAYER);
    renderer.render(this.scene, this.camera);
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
    const radius = this.target.radius;
    camera.updateMatrixWorld();

    const centreView = this.centreView.copy(this.target.position).applyMatrix4(camera.matrixWorldInverse);
    const ndc = this.centreNdc.copy(centreView).applyMatrix4(camera.projectionMatrix);
    this.centre.set(ndc.x * 0.5 + 0.5, ndc.y * 0.5 + 0.5);
    uniforms.uCentre.value.copy(this.centre);

    // Angular radius of the core sphere's silhouette, as a fraction of the screen height.
    const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / camera.zoom;
    const sinCore = Math.min(radius / centreView.length(), 0.99);
    this.coreRadius = (0.5 * sinCore) / Math.sqrt(1 - sinCore * sinCore) / tanHalfFov;
    uniforms.uUvToLens.value.set(camera.aspect / this.coreRadius, 1 / this.coreRadius);

    uniforms.uTanHalfFov.value.set(tanHalfFov * camera.aspect, tanHalfFov);
    uniforms.uPlaneNormal.value.copy(WORLD_UP).transformDirection(camera.matrixWorldInverse);
    uniforms.uLensView.value.copy(centreView);
    uniforms.uPlayerRadius.value = radius;
    uniforms.uSampleZone.value = LENSING.sampleZone * lensUniforms.uLensEinstein.value;
  }
}
