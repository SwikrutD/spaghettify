import * as THREE from 'three';
import { COMETS, SPAGHETTI } from '../config';
import type { CometField } from '../sim/CometField.ts';
import { viewDistance } from '../sim/Hole.ts';
import { lerp } from '../sim/math.ts';
import { hash01 } from '../sim/rng.ts';
import { OVERLAY_LAYER } from '../render/layers';
import vert from '../shaders/cometTail.vert.glsl';
import frag from '../shaders/cometTail.frag.glsl';
import { drawnEatProgress, eaterPosition, PreyMesh, type BodyFrame } from './PreyMesh';

const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpMat = new THREE.Matrix4();
const ONE = new THREE.Vector3(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);
const ZERO_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * Comets as drawn: the icy nucleus is a PreyMesh instance (so an eaten comet spaghettifies like prey) and the
 * tail one instanced flat quad per comet with a streaky ion tail, a broader dust tail and a coma. Fixed pool,
 * two draw calls.
 */
export class CometFieldMesh {
  readonly group = new THREE.Group();
  private readonly nuclei = new PreyMesh(COMETS.poolSize);
  private readonly tails: THREE.InstancedMesh;
  private readonly shapeAttr: THREE.InstancedBufferAttribute;
  private readonly seedAttr: THREE.InstancedBufferAttribute;
  private readonly timeUniform = { value: 0 };
  /** Comet generation each tail's streak seed was set for. */
  private readonly gens = new Float64Array(COMETS.poolSize).fill(-1);
  private readonly field: CometField;

  constructor(field: CometField) {
    this.field = field;
    // Unit quad on the play plane: x in -1..1 (negative is the coma ahead of the nucleus), z in -1..1.
    const geometry = new THREE.PlaneGeometry(2, 2, 8, 2);
    geometry.rotateX(-Math.PI / 2);
    this.shapeAttr = new THREE.InstancedBufferAttribute(new Float32Array(COMETS.poolSize * 4), 4);
    this.shapeAttr.setUsage(THREE.DynamicDrawUsage);
    this.seedAttr = new THREE.InstancedBufferAttribute(new Float32Array(COMETS.poolSize), 1);
    geometry.setAttribute('aShape', this.shapeAttr);
    geometry.setAttribute('aSeed', this.seedAttr);
    const material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        uIonColor: { value: new THREE.Color(COMETS.ionColor).multiplyScalar(COMETS.intensity) },
        uDustColor: { value: new THREE.Color(COMETS.dustColor).multiplyScalar(COMETS.intensity) },
        uFlare: { value: COMETS.tailFlare },
        uTime: this.timeUniform,
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      // Additive colour, alpha left untouched.
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    this.tails = new THREE.InstancedMesh(geometry, material, COMETS.poolSize);
    this.tails.frustumCulled = false;
    // Drawn with the hole's parts after the lens, unbent. On layer 0 the lens would treat this glow on the play
    // plane as far background and bend it hard, leaving hard-edged bright ghosts around the nucleus.
    this.tails.layers.set(OVERLAY_LAYER);
    this.tails.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.tails, this.nuclei.mesh);
  }

  update(frame: BodyFrame): void {
    this.timeUniform.value += frame.dt;
    this.nuclei.begin(frame);
    const objects = this.field.objects;
    for (let i = 0; i < objects.length; i++) {
      const comet = objects[i];
      if (!comet.active) {
        this.tails.setMatrixAt(i, ZERO_MATRIX);
        continue;
      }
      if (this.gens[i] !== comet.gen) {
        this.gens[i] = comet.gen;
        this.seedAttr.setX(i, hash01(comet.seed, 8));
        this.seedAttr.needsUpdate = true;
      }
      this.nuclei.add(comet, frame);

      // Local +x points back along the path: rotate about Y so (1, 0, 0) maps to -velocity.
      tmpQuat.setFromAxisAngle(UP, Math.atan2(comet.velocity.z, -comet.velocity.x));
      // During the infall the tail follows the falling nucleus.
      if (comet.state === 'eating') {
        const fall = drawnEatProgress(comet, frame.alpha) ** SPAGHETTI.accelPower;
        eaterPosition(frame, comet, tmpPos);
        tmpPos.x += comet.eatOffset.x * (1 - fall);
        tmpPos.z += comet.eatOffset.z * (1 - fall);
      } else {
        tmpPos.set(lerp(comet.prevX, comet.position.x, frame.alpha), 0, lerp(comet.prevZ, comet.position.z, frame.alpha));
      }
      tmpMat.compose(tmpPos, tmpQuat, ONE);
      this.tails.setMatrixAt(i, tmpMat);
      // The tail reaches a fraction of the view of the hole it was sized for (its nucleus is about that hole's size).
      const length = comet.radius * COMETS.tailLengthRadii + COMETS.tailLengthView * viewDistance(comet.radius);
      this.shapeAttr.setXYZW(i, length, comet.radius * COMETS.tailWidth * 0.5, comet.radius * COMETS.comaRadius, comet.fade);
    }
    this.nuclei.end();
    this.tails.instanceMatrix.needsUpdate = true;
    this.shapeAttr.needsUpdate = true;
  }
}
