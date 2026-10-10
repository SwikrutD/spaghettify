import * as THREE from 'three';
import { HOLES } from '../config';
import { OVERLAY_LAYER } from '../render/layers';
import vert from '../shaders/mergerRipple.vert.glsl';
import frag from '../shaders/mergerRipple.frag.glsl';

const POOL = 4;

interface Ripple {
  mesh: THREE.Mesh;
  age: { value: number };
  /** Seconds since it started, or -1 when idle. */
  time: number;
}

/**
 * The gravitational wave ripple of a hole eating a hole: a ring spreading over the play plane from the eater, with
 * a fainter one behind it. A small pool of flat quads, drawn with the hole's own parts after the lens (never bent).
 */
export class MergerRipple {
  readonly group = new THREE.Group();
  private readonly ripples: Ripple[] = [];

  constructor() {
    for (let i = 0; i < POOL; i++) {
      const age = { value: 0 };
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        new THREE.ShaderMaterial({
          vertexShader: vert,
          fragmentShader: frag,
          uniforms: {
            uAge: age,
            uWidth: { value: HOLES.ripple.width / HOLES.ripple.reach },
            uColor: { value: new THREE.Color(0x9cc4ff).multiplyScalar(HOLES.ripple.intensity) },
          },
          transparent: true,
          depthWrite: false,
          depthTest: false,
          blending: THREE.CustomBlending,
          blendSrc: THREE.OneFactor,
          blendDst: THREE.OneFactor,
          blendSrcAlpha: THREE.ZeroFactor,
          blendDstAlpha: THREE.OneFactor,
        }),
      );
      // Lie flat on the play plane (the quad is built in XY).
      mesh.rotation.x = -Math.PI / 2;
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.layers.set(OVERLAY_LAYER);
      this.group.add(mesh);
      this.ripples.push({ mesh, age, time: -1 });
    }
  }

  /** Start a ripple at (x, z) from an eater of this radius; a busy pool reuses the oldest. */
  emit(x: number, z: number, eaterRadius: number): void {
    let ripple = this.ripples.find((r) => r.time < 0);
    if (!ripple) ripple = this.ripples.reduce((a, b) => (b.time > a.time ? b : a));
    ripple.time = 0;
    ripple.mesh.visible = true;
    ripple.mesh.position.set(x, 0, z);
    ripple.mesh.scale.setScalar(eaterRadius * HOLES.ripple.reach);
    ripple.age.value = 0;
  }

  update(dt: number): void {
    for (const ripple of this.ripples) {
      if (ripple.time < 0) continue;
      ripple.time += dt;
      ripple.age.value = ripple.time / HOLES.ripple.time;
      if (ripple.age.value >= 1) {
        ripple.time = -1;
        ripple.mesh.visible = false;
      }
    }
  }

  reset(): void {
    for (const ripple of this.ripples) {
      ripple.time = -1;
      ripple.mesh.visible = false;
    }
  }
}
