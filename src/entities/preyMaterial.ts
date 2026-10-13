import * as THREE from 'three';
import { DEBRIS, PREY, SPAGHETTI } from '../config';
import stretchParsVert from '../shaders/preySpaghettify.pars.vert.glsl';
import stretchVert from '../shaders/preySpaghettify.vert.glsl';
import glowParsFrag from '../shaders/preyGlow.pars.frag.glsl';
import glowFrag from '../shaders/preyGlow.frag.glsl';
import surfaceParsVert from '../shaders/preySurface.pars.vert.glsl';
import surfaceVert from '../shaders/preySurface.vert.glsl';
import surfaceParsFrag from '../shaders/preySurface.pars.frag.glsl';
import surfaceFrag from '../shaders/preySurface.frag.glsl';

/**
 * Lit prey material with tidal stretching (spaghettification) in the vertex shader. `smooth` is for the round
 * bodies (smooth shading, normals bent with the stretch); otherwise flat-shaded rock. `surface` adds the procedural
 * surface from the per-instance `aSurface` (a pattern per class on the round bodies, regolith and craters on rocks,
 * see preySurface.pars.frag.glsl); the round bodies always have it.
 * Stays opaque: prey must write alpha 1, the lensing pass uses scene alpha as its play-plane mask.
 * Reads the per-instance attributes `aStretch` (vec4), `aHole` (vec3) and `aGlow` and `aHeat` (floats), see preySpaghettify.pars.vert.glsl.
 */
export function createPreyMaterial(smooth = false, surface = smooth): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    roughness: smooth ? PREY.sphereRoughness : 0.95,
    metalness: 0,
    flatShading: !smooth,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uSqueeze: { value: SPAGHETTI.squeeze },
      uKnee: { value: SPAGHETTI.knee },
      uGlowReach: { value: SPAGHETTI.glowReach },
      uGlowColor: { value: new THREE.Color(SPAGHETTI.glowColor).multiplyScalar(SPAGHETTI.glowIntensity) },
      uHeatHot: { value: new THREE.Color(DEBRIS.hotColor).multiplyScalar(DEBRIS.heatIntensity) },
      uHeatCool: { value: new THREE.Color(DEBRIS.coolColor).multiplyScalar(DEBRIS.heatIntensity) },
    });
    shader.vertexShader = inject(shader.vertexShader, '#include <common>', `#include <common>\n${stretchParsVert}`);
    shader.vertexShader = inject(shader.vertexShader, '#include <project_vertex>', stretchVert);
    shader.fragmentShader = inject(shader.fragmentShader, '#include <common>', `#include <common>\n${glowParsFrag}`);
    shader.fragmentShader = inject(
      shader.fragmentShader,
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>\n${glowFrag}`,
    );
    if (surface) {
      shader.vertexShader = inject(shader.vertexShader, '#include <common>', `#include <common>\n${surfaceParsVert}`);
      shader.vertexShader = inject(shader.vertexShader, '#include <begin_vertex>', `#include <begin_vertex>\n${surfaceVert}`);
      shader.fragmentShader = inject(shader.fragmentShader, '#include <common>', `#include <common>\n${surfaceParsFrag}`);
      shader.fragmentShader = inject(shader.fragmentShader, '#include <color_fragment>', `#include <color_fragment>\n${surfaceFrag}`);
    }
  };
  material.customProgramCacheKey = () => `prey-spaghettify${smooth ? '-smooth' : ''}${surface ? '-surface' : ''}`;
  return material;
}

/** Replace a three.js chunk include, failing loudly if a three.js upgrade renamed it. */
function inject(source: string, anchor: string, replacement: string): string {
  if (!source.includes(anchor)) throw new Error(`prey material: shader chunk ${anchor} not found`);
  return source.replace(anchor, () => replacement);
}
