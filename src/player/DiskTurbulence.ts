import * as THREE from 'three';
import { DISK, QUALITY } from '../config';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import fullscreenVert from '../shaders/fullscreen.vert.glsl';
import turbulenceFrag from '../shaders/diskTurbulence.frag.glsl';

/** Loop bound for the disk's noise octaves (the live count is a uniform). */
export const MAX_OCTAVES = 3;

/** Number uniform; widens `as const` config literals to number. */
const num = (value: number): { value: number } => ({ value });

/**
 * Height of layer l of `layers` in -1..1. Three layers sit at -1, 0, 1; fewer layers stay nearer the
 * midplane (two at -0.5 and 0.5, one at 0) so a lower quality level keeps the same overall look.
 */
export function layerHeight(l: number, layers: number): number {
  return layers === 1 ? 0 : ((l / (layers - 1)) * 2 - 1) * Math.min(1, (layers - 1) / 2);
}

/** Heights of up to three layers, one per turbulence map channel. */
export function layerHeights(layers: number): THREE.Vector3 {
  return new THREE.Vector3(layerHeight(0, layers), layerHeight(1, layers), layerHeight(2, layers));
}

/**
 * The disks' turbulence: a polar map (angle by log radius, one channel per layer, half float) of the flowing noise,
 * rendered once per frame and sampled by every accretion disk, so the noise costs the same however many holes are
 * on screen and however big they are. Each disk sees it from its own angle (see AccretionDisk).
 */
export class DiskTurbulence {
  readonly target: THREE.WebGLRenderTarget;
  readonly logRange = new THREE.Vector2(Math.log(DISK.innerRadius), Math.log(DISK.outerRadiusMax));
  private layers: number = QUALITY.levels[0].diskLayers;
  private time = 0;
  private readonly uniforms;
  private readonly quad: FullScreenQuad;

  constructor() {
    this.target = new THREE.WebGLRenderTarget(DISK.turbulenceWidth, DISK.turbulenceHeight, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      generateMipmaps: false,
    });
    this.uniforms = {
      uTime: num(0),
      uInner: num(DISK.innerRadius),
      uSpin: num(DISK.spin),
      uOmegaInner: num(DISK.innerAngularSpeed),
      uFlowPeriod: num(DISK.flowPeriod),
      uNoiseRadialFreq: num(DISK.noiseRadialFreq),
      uNoiseAngularFreq: num(DISK.noiseAngularFreq),
      uSpiralTwist: num(DISK.spiralTwist),
      uLogRange: { value: this.logRange },
      uOctaves: num(QUALITY.levels[0].diskOctaves),
      uLayers: num(this.layers),
      uLayerHeights: { value: layerHeights(this.layers) },
    };
    this.quad = new FullScreenQuad(
      new THREE.ShaderMaterial({
        vertexShader: fullscreenVert,
        fragmentShader: turbulenceFrag,
        uniforms: this.uniforms,
        defines: { MAX_OCTAVES },
        depthTest: false,
        depthWrite: false,
        blending: THREE.NoBlending,
      }),
    );
  }

  /** Stacked layers (1 to 3) and noise octaves (1 to MAX_OCTAVES) of a quality level. */
  setDetail(layers: number, octaves: number): void {
    this.uniforms.uOctaves.value = THREE.MathUtils.clamp(Math.round(octaves), 1, MAX_OCTAVES);
    layers = THREE.MathUtils.clamp(Math.round(layers), 1, 3);
    if (layers === this.layers) return;
    this.layers = layers;
    this.uniforms.uLayers.value = layers;
    this.uniforms.uLayerHeights.value = layerHeights(layers);
  }

  /** Size the map for a render this many pixels high (the disk's size on screen follows the height). */
  setRenderHeight(pixels: number): void {
    const scale = Math.min(1, pixels / DISK.turbulenceRefHeight);
    const width = Math.max(DISK.turbulenceMinWidth, Math.round(DISK.turbulenceWidth * scale));
    const height = Math.round((width * DISK.turbulenceHeight) / DISK.turbulenceWidth);
    if (width !== this.target.width || height !== this.target.height) this.target.setSize(width, height);
  }

  /** Advance the flow by `dt` seconds. */
  update(dt: number): void {
    this.time += dt;
  }

  /** Render this frame's map. Call before the scene is rendered. */
  prepare(renderer: THREE.WebGLRenderer): void {
    this.uniforms.uTime.value = this.time;
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    this.quad.render(renderer);
    renderer.setRenderTarget(previous);
  }
}
