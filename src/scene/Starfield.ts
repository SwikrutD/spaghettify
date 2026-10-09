import * as THREE from 'three';
import { STARFIELD } from '../config';
import vert from '../shaders/starfield.vert.glsl';
import frag from '../shaders/starfield.frag.glsl';

/** Static stars scattered below the play plane so movement reads through parallax. */
export function createStarfield(): THREE.Points {
  const n = STARFIELD.count;
  const pos = new Float32Array(n * 3);
  const size = new Float32Array(n);
  const bright = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (Math.random() * 2 - 1) * STARFIELD.extent;
    pos[i * 3 + 1] = -(STARFIELD.minDepth + Math.random() * (STARFIELD.maxDepth - STARFIELD.minDepth));
    pos[i * 3 + 2] = (Math.random() * 2 - 1) * STARFIELD.extent;
    size[i] = 0.6 + Math.random() * 1.6;
    bright[i] = 0.3 + Math.pow(Math.random(), 3) * 1.4;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aBright', new THREE.BufferAttribute(bright, 1));
  const mat = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    // Additive colour, but alpha left untouched: the lensing pass reads scene alpha as
    // "a play-plane object is here" and stars are background.
    blending: THREE.CustomBlending,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return points;
}
