import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { BLOOM, RENDER } from '../config';
import { CorePass } from './CorePass';
import { LensingPass, type LensTarget } from './LensingPass';

/** WebGL renderer plus the post-processing chain (render, lensing, bloom, core, output). */
export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly lensing: LensingPass;
  private readonly composer: EffectComposer;

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
    this.composer.addPass(new RenderPass(scene, camera));
    this.composer.addPass(this.lensing);
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), BLOOM.strength, BLOOM.radius, BLOOM.threshold));
    if (BLOOM.keepCoreBlack) this.composer.addPass(new CorePass(scene, camera));
    this.composer.addPass(new OutputPass());
  }

  resize(width: number, height: number): void {
    const pr = Math.min(window.devicePixelRatio, RENDER.maxPixelRatio);
    this.gl.setPixelRatio(pr);
    this.gl.setSize(width, height, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(width, height);
  }

  render(): void {
    this.composer.render();
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
