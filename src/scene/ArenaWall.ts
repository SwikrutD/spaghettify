import * as THREE from 'three';
import { ARENA, ARENA_WALL } from '../config';
import { edgeWidth } from '../sim/arena.ts';
import { viewDistance } from '../sim/Hole.ts';
import { OVERLAY_LAYER } from '../render/layers';
import vert from '../shaders/arenaWall.vert.glsl';
import frag from '../shaders/arenaWall.frag.glsl';

/**
 * The arena edge as drawn: a dense gas wall (see arenaWall.frag.glsl), a flat annulus on the play plane reaching
 * from just inside the widest soft edge to far outside the arena. Drawn after the lens, unbent, like the other
 * glows on the play plane; it hides what is behind it but never writes the scene alpha the lens reads.
 */
export class ArenaWall {
  readonly mesh: THREE.Mesh;
  private readonly uniforms = {
    uRadius: { value: ARENA.radius as number },
    uView: { value: 1 },
    uWidth: { value: 1 },
    uTime: { value: 0 },
    uGlow: { value: new THREE.Color(ARENA_WALL.glowColor).multiplyScalar(ARENA_WALL.glowIntensity) },
    uGas: { value: new THREE.Color(ARENA_WALL.gasColor) },
    uOpacity: { value: ARENA_WALL.opacity as number },
  };

  constructor() {
    const inner = ARENA.radius - ARENA.edgeMaxWidth * 1.5;
    const outer = ARENA.radius * ARENA_WALL.outerRadius;
    const geometry = new THREE.RingGeometry(inner, outer, ARENA_WALL.segments, 8);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      // Premultiplied over, alpha left untouched.
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.layers.set(OVERLAY_LAYER);
    this.mesh.renderOrder = -1;
  }

  /** `radius` is the local hole's as drawn; `dt` real seconds. */
  update(dt: number, radius: number): void {
    this.uniforms.uTime.value += dt;
    this.uniforms.uView.value = viewDistance(radius);
    this.uniforms.uWidth.value = edgeWidth(radius);
  }
}
