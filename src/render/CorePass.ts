import * as THREE from 'three';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { CORE_LAYER } from './layers';

/**
 * Redraws objects on CORE_LAYER after bloom, depth-tested against the scene depth that is still
 * attached to the read buffer (the lensing pass writes the bent scene depth there). Bloom glow then
 * stops at the shadow's edge, so the core stays crisp, while anything in front of the core
 * (prey falling in) still covers it.
 */
export class CorePass extends Pass {
  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
  ) {
    super();
    this.needsSwap = false;
  }

  render(renderer: THREE.WebGLRenderer, _writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    const mask = this.camera.layers.mask;
    const autoClear = renderer.autoClear;
    this.camera.layers.set(CORE_LAYER);
    renderer.autoClear = false;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    renderer.render(this.scene, this.camera);
    renderer.autoClear = autoClear;
    this.camera.layers.mask = mask;
  }
}
