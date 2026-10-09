import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { BLOOM, RENDER, type QualityLevel } from '../config';
import { CorePass } from './CorePass';
import { GpuTimer } from './GpuTimer';
import { LensingPass, type LensTarget } from './LensingPass';

/** UnrealBloomPass whose buffers can run at a fraction of the size the composer gives it. */
class ScaledBloomPass extends UnrealBloomPass {
  private scale = 1;
  private fullWidth = 1;
  private fullHeight = 1;

  setScale(scale: number): void {
    if (scale === this.scale) return;
    this.scale = scale;
    this.setSize(this.fullWidth, this.fullHeight);
  }

  setSize(width: number, height: number): void {
    this.fullWidth = width;
    this.fullHeight = height;
    const scale = this.scale ?? 1;
    super.setSize(Math.max(2, Math.round(width * scale)), Math.max(2, Math.round(height * scale)));
  }
}

/** WebGL renderer plus the post-processing chain (render, lensing, bloom, core, output). */
export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly lensing: LensingPass;
  /** GPU time per pass, once enableProfiling() has run (null if the timer extension is missing). */
  timer: GpuTimer | null = null;
  /** Off-screen work that must happen before the scene renders (the disk's turbulence map). */
  onBeforeRender: ((gl: THREE.WebGLRenderer) => void) | null = null;
  private readonly composer: EffectComposer;
  private readonly bloom: ScaledBloomPass;
  private readonly core: CorePass | null = null;
  /** Render resolution as a fraction of the capped device pixel ratio (quality level). */
  private resolution = 1;
  private width = 1;
  private height = 1;
  /** Profiling labels of the passes that do not time themselves. */
  private readonly passLabels = new Map<Pass, string>();

  constructor(canvas: HTMLCanvasElement, scene: THREE.Scene, camera: THREE.PerspectiveCamera, lensTarget: LensTarget) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    // Clear alpha 0: in the scene render, alpha 1 marks play-plane objects for the lensing pass.
    this.gl.setClearColor(RENDER.clearColor, 0);
    // Applied by the OutputPass at the end of the chain.
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = RENDER.toneMappingExposure;
    this.composer = new EffectComposer(this.gl);
    // The lensing pass reads the scene depth and writes the bent depth, so both ping-pong buffers carry a depth texture.
    for (const target of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      target.depthTexture = new THREE.DepthTexture(target.width, target.height);
    }
    this.lensing = new LensingPass(scene, camera, lensTarget);
    this.addPass(new RenderPass(scene, camera), 'scene');
    // The lensing pass times its own two sections (lens quad, then the hole drawn over it).
    this.composer.addPass(this.lensing);
    this.bloom = new ScaledBloomPass(new THREE.Vector2(1, 1), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
    this.addPass(this.bloom, 'bloom');
    if (BLOOM.keepCoreBlack) {
      this.core = new CorePass(scene, camera);
      this.addPass(this.core, 'core');
    }
    this.addPass(new OutputPass(), 'output');
  }

  /** Canvas size in CSS pixels. */
  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.applySize();
  }

  /** Render resolution, bloom and lens detail of a quality level. The disk's detail is set on the disk. */
  setQuality(level: QualityLevel): void {
    this.lensing.setSamples(level.lensSamples);
    // The core redraw only exists to keep bloom off the shadow.
    this.bloom.enabled = level.bloom > 0;
    if (this.core) this.core.enabled = this.bloom.enabled;
    if (level.bloom > 0) this.bloom.setScale(level.bloom);
    if (level.resolution !== this.resolution) {
      this.resolution = level.resolution;
      this.applySize();
    }
    this.timer?.clear();
  }

  /** The pixel ratio actually rendered at: device pixel ratio, capped, times the quality level's resolution. */
  get pixelRatio(): number {
    return this.gl.getPixelRatio();
  }

  /** Height of the render in pixels. */
  get bufferHeight(): number {
    return this.gl.getContext().drawingBufferHeight;
  }

  private applySize(): void {
    const pr = Math.min(window.devicePixelRatio, RENDER.maxPixelRatio) * this.resolution;
    this.gl.setPixelRatio(pr);
    this.gl.setSize(this.width, this.height, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(this.width, this.height);
  }

  render(): void {
    if (this.onBeforeRender) {
      this.timer?.begin('noise');
      this.onBeforeRender(this.gl);
      this.timer?.end();
    }
    this.composer.render();
    this.timer?.poll();
  }

  /** Time each pass on the GPU (debug and `?perf` only). Returns false if the timer extension is missing. */
  enableProfiling(): boolean {
    if (this.timer) return true;
    this.timer = GpuTimer.create(this.gl.getContext() as WebGL2RenderingContext);
    const timer = this.timer;
    if (!timer) return false;
    this.lensing.timer = timer;
    for (const [pass, label] of this.passLabels) {
      const render = pass.render.bind(pass);
      pass.render = (...args) => {
        timer.begin(label);
        render(...args);
        timer.end();
      };
    }
    return true;
  }

  private addPass(pass: Pass, label: string): void {
    this.composer.addPass(pass);
    this.passLabels.set(pass, label);
  }

  /** Final RGB (0-255) at a canvas pixel in CSS pixels, y down. Only valid right after render(), within the same frame. */
  readPixel(x: number, y: number): [number, number, number] {
    const gl = this.gl.getContext();
    const pr = this.gl.getPixelRatio();
    const out = new Uint8Array(4);
    gl.readPixels(Math.floor(x * pr), gl.drawingBufferHeight - 1 - Math.floor(y * pr), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return [out[0], out[1], out[2]];
  }
}
