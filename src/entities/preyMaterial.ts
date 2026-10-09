import * as THREE from 'three';
import { PREY, SPAGHETTI } from '../config';
import stretchParsVert from '../shaders/preySpaghettify.pars.vert.glsl';
import stretchVert from '../shaders/preySpaghettify.vert.glsl';
import glowParsFrag from '../shaders/preyGlow.pars.frag.glsl';
import glowFrag from '../shaders/preyGlow.frag.glsl';

/** Per-frame uniforms of the prey material. `uHole` is (hole x, hole z, core radius). */
export interface PreyUniforms {
  uHole: { value: THREE.Vector3 };
}

/**
 * Lit prey material with tidal stretching (spaghettification) in the vertex shader. `smooth` is for the round
 * bodies (smooth shading, normals bent with the stretch); otherwise flat-shaded rock.
 * Stays opaque: prey must write alpha 1, the lensing pass uses scene alpha as its play-plane mask.
 * Reads the per-instance attributes `aStretch` (vec4) and `aGlow` (float), see preySpaghettify.pars.vert.glsl.
 */
export function createPreyMaterial(smooth = false): { material: THREE.MeshStandardMaterial; uniforms: PreyUniforms } {
  const uniforms = { uHole: { value: new THREE.Vector3(0, 0, 1) } };
  const material = new THREE.MeshStandardMaterial({
    roughness: smooth ? PREY.sphereRoughness : 0.95,
    metalness: 0,
    flatShading: !smooth,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, {
      uSqueeze: { value: SPAGHETTI.squeeze },
      uKnee: { value: SPAGHETTI.knee },
      uGlowReach: { value: SPAGHETTI.glowReach },
      uGlowColor: { value: new THREE.Color(SPAGHETTI.glowColor).multiplyScalar(SPAGHETTI.glowIntensity) },
    });
    shader.vertexShader = inject(shader.vertexShader, '#include <common>', `#include <common>\n${stretchParsVert}`);
    shader.vertexShader = inject(shader.vertexShader, '#include <project_vertex>', stretchVert);
    shader.fragmentShader = inject(shader.fragmentShader, '#include <common>', `#include <common>\n${glowParsFrag}`);
    shader.fragmentShader = inject(
      shader.fragmentShader,
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>\n${glowFrag}`,
    );
  };
  material.customProgramCacheKey = () => (smooth ? 'prey-spaghettify-smooth' : 'prey-spaghettify');
  return { material, uniforms };
}

/** Replace a three.js chunk include, failing loudly if a three.js upgrade renamed it. */
function inject(source: string, anchor: string, replacement: string): string {
  if (!source.includes(anchor)) throw new Error(`prey material: shader chunk ${anchor} not found`);
  return source.replace(anchor, () => replacement);
}
