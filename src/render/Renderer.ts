import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { BLOOM, RENDER } from '../config';
import { CorePass } from './CorePass';

/** WebGL renderer plus the post-processing chain (render, bloom, output). */
export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;

  constructor(canvas: HTMLCanvasElement, scene: THREE.Scene, camera: THREE.Camera) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.gl.setClearColor(RENDER.clearColor);
    // Applied by the OutputPass at the end of the chain.
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = RENDER.toneMappingExposure;
    this.composer = new EffectComposer(this.gl);
    this.composer.addPass(new RenderPass(scene, camera));
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
}
