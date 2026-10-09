import * as THREE from 'three';
import { COMETS, PREY, SPAGHETTI, type Tier } from '../config';
import { massOfRadius, type Player } from '../player/Player';
import { OVERLAY_LAYER } from '../render/layers';
import vert from '../shaders/cometTail.vert.glsl';
import frag from '../shaders/cometTail.frag.glsl';
import { beginInfall, canSwallow, createPreyObject, lerp, logUniform, PreyMesh, randomSpin, type PreyObject } from './PreyMesh';
import type { ViewSource } from './PreyField';

/** A pooled comet: an icy nucleus (a prey object, so it spaghettifies when eaten) with a tail. */
export interface Comet extends PreyObject {
  /** False for an idle pool slot. */
  active: boolean;
  /** 0..1 tail and coma brightness: fades in on entry and out during the infall. */
  fade: number;
  /** Random per comet, varies the tail streaks. */
  seed: number;
}

const tmpColor = new THREE.Color();
const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpMat = new THREE.Matrix4();
const ONE = new THREE.Vector3(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);
const ZERO_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * Comets, the roaming hazard: they enter just off screen on a timer from the tier's `comets` table and cross
 * the view on a straight line, trailing a glowing tail. One the hole cannot eat knocks it back (see Dangers);
 * once the hole is big enough it is a fast meal. Fixed pool, two draw calls (nuclei and tails).
 */
export class CometField {
  readonly group = new THREE.Group();
  readonly objects: Comet[] = [];
  /** Comets launched this run (tests). */
  launched = 0;
  private readonly nuclei = new PreyMesh(COMETS.poolSize);
  private readonly tails: THREE.InstancedMesh;
  private readonly shapeAttr: THREE.InstancedBufferAttribute;
  private readonly seedAttr: THREE.InstancedBufferAttribute;
  private readonly timeUniform = { value: 0 };
  private tier: Tier;
  /** Seconds until the next comet. */
  private timer: number;

  constructor(
    private readonly player: Player,
    private readonly view: ViewSource,
    tier: Tier,
  ) {
    this.tier = tier;
    this.timer = tier.comets.firstDelay;

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
    this.nuclei.mesh.count = COMETS.poolSize;
    this.group.add(this.tails, this.nuclei.mesh);

    for (let i = 0; i < COMETS.poolSize; i++) {
      const comet: Comet = Object.assign(createPreyObject(), { active: false, fade: 0, seed: Math.random() });
      comet.className = 'comet';
      this.objects.push(comet);
      this.seedAttr.setX(i, comet.seed);
      this.hide(i);
    }
    this.nuclei.commit();
    this.tails.instanceMatrix.needsUpdate = true;
  }

  setTier(tier: Tier): void {
    this.tier = tier;
    this.timer = Math.min(this.timer, tier.comets.firstDelay);
  }

  /** Start of a new run: no comets, first one after the tier's delay. */
  reset(tier: Tier): void {
    this.tier = tier;
    this.timer = tier.comets.firstDelay;
    this.launched = 0;
    for (let i = 0; i < this.objects.length; i++) {
      this.objects[i].active = false;
      this.hide(i);
    }
    this.nuclei.commit();
    this.tails.instanceMatrix.needsUpdate = true;
  }

  /** Launch a comet from the tier's table: enters on the spawn ring, aimed near the hole. */
  spawn(): Comet | null {
    const c = this.tier.comets;
    const view = this.view.targetDistance;
    const p = this.player.position;
    const angle = Math.random() * Math.PI * 2;
    const x = p.x + Math.cos(angle) * COMETS.spawnDistance * view;
    const z = p.z + Math.sin(angle) * COMETS.spawnDistance * view;
    const aimAngle = Math.random() * Math.PI * 2;
    const aim = Math.sqrt(Math.random()) * COMETS.aimSpread * view;
    const dx = p.x + Math.cos(aimAngle) * aim - x;
    const dz = p.z + Math.sin(aimAngle) * aim - z;
    const speed = lerp(c.speed[0], c.speed[1], Math.random()) * view / Math.max(1e-6, Math.hypot(dx, dz));
    return this.launch(x, z, dx * speed, dz * speed, logUniform(c.radius[0], c.radius[1]));
  }

  /** Launch a comet at a given place, velocity (world units per second) and nucleus radius. Null when the pool is full. */
  launch(x: number, z: number, vx: number, vz: number, radius: number): Comet | null {
    const i = this.objects.findIndex((o) => !o.active);
    if (i < 0) return null;
    const comet = this.objects[i];
    comet.active = true;
    comet.state = 'alive';
    comet.appear = 1;
    comet.fade = 0;
    comet.eatProgress = 0;
    comet.stretch = 1;
    comet.radius = radius;
    comet.mass = massOfRadius(radius);
    comet.position.set(x, 0, z);
    comet.velocity.set(vx, 0, vz);
    randomSpin(comet);
    const { hue, sat, light } = COMETS.color;
    tmpColor.setHSL(lerp(hue[0], hue[1], Math.random()), lerp(sat[0], sat[1], Math.random()), lerp(light[0], light[1], Math.random()));
    this.nuclei.setColor(i, tmpColor);
    this.launched++;
    return comet;
  }

  update(dt: number): void {
    const player = this.player;
    const view = this.view.targetDistance;
    const despawnSq = (COMETS.despawnDistance * view) ** 2;
    this.timeUniform.value += dt;

    this.timer -= dt;
    if (this.timer <= 0) {
      const c = this.tier.comets;
      this.timer = lerp(c.interval[0], c.interval[1], Math.random());
      this.spawn();
    }

    this.nuclei.setHole(player);
    for (let i = 0; i < this.objects.length; i++) {
      const comet = this.objects[i];
      if (!comet.active) continue;

      if (comet.state === 'eating') {
        comet.eatProgress += dt / comet.infallTime;
        comet.fade = Math.max(0, 1 - comet.eatProgress * 2);
        if (comet.eatProgress >= 1) {
          comet.active = false;
          this.hide(i);
          continue;
        }
      } else {
        comet.position.addScaledVector(comet.velocity, dt);
        comet.fade = Math.min(1, comet.fade + dt / COMETS.appearTime);
        const dx = comet.position.x - player.position.x;
        const dz = comet.position.z - player.position.z;
        const distSq = dx * dx + dz * dz;
        // Gone once it is far and heading away.
        if (distSq > despawnSq && dx * comet.velocity.x + dz * comet.velocity.z > 0) {
          comet.active = false;
          this.hide(i);
          continue;
        }
        if (player.canEat && canSwallow(comet.radius, player.radius)) {
          const reach = player.radius + comet.radius * PREY.eatReach;
          if (distSq < reach * reach) beginInfall(comet, player);
        }
      }
      comet.spinAngle += comet.spinSpeed * dt;
      this.nuclei.write(i, comet, player);
      this.writeTail(i, comet, view);
    }
    this.nuclei.commit();
    this.tails.instanceMatrix.needsUpdate = true;
    this.shapeAttr.needsUpdate = true;
  }

  private writeTail(i: number, comet: Comet, view: number): void {
    const vx = comet.velocity.x;
    const vz = comet.velocity.z;
    // Local +x points back along the path: rotate about Y so (1, 0, 0) maps to -velocity.
    const angle = Math.atan2(vz, -vx);
    tmpQuat.setFromAxisAngle(UP, angle);
    // During the infall the tail follows the falling nucleus.
    if (comet.state === 'eating') {
      const fall = Math.min(1, comet.eatProgress) ** SPAGHETTI.accelPower;
      tmpPos.copy(this.player.position).addScaledVector(comet.eatOffset, 1 - fall);
    } else {
      tmpPos.copy(comet.position);
    }
    tmpMat.compose(tmpPos, tmpQuat, ONE);
    this.tails.setMatrixAt(i, tmpMat);
    const length = comet.radius * COMETS.tailLengthRadii + COMETS.tailLengthView * view;
    this.shapeAttr.setXYZW(i, length, comet.radius * COMETS.tailWidth * 0.5, comet.radius * COMETS.comaRadius, comet.fade);
  }

  private hide(i: number): void {
    this.nuclei.hide(i);
    this.tails.setMatrixAt(i, ZERO_MATRIX);
  }
}
