import * as THREE from 'three';
import { DISK, PREY, PREY_POOL_SIZE, SPAGHETTI, tierMinRadius, type PreyClass, type Tier } from '../config';
import { massOfRadius, type Player } from '../player/Player';
import { createPreyMaterial, type PreyUniforms } from './preyMaterial';

export type PreyState = 'alive' | 'eating';

/** One pooled prey object. The pool never grows or shrinks; entries are reused. */
export interface PreyObject {
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  radius: number;
  mass: number;
  /** Name of the tier-table class this object was drawn from, e.g. "asteroid". */
  className: string;
  state: PreyState;
  /** 0..1 scale-in after (re)spawning. */
  appear: number;
  /** 0..1 progress of the infall after being eaten. */
  eatProgress: number;
  /** Infall duration in seconds (bigger prey fall in more slowly). */
  infallTime: number;
  /** Offset from the hole when eaten. The infall follows the hole if it moves. */
  readonly eatOffset: THREE.Vector3;
  /** Size weight (0..1) fixed when eaten: scales the stretch and curl of the infall. */
  infallWeight: number;
  /** Stretch factor at the moment it was eaten, so the infall continues from the approach stretch. */
  stretchFrom: number;
  /** Current tidal stretch factor (1 = none), as sent to the GPU. */
  stretch: number;
  /** Last unit direction from the hole to the object on the play plane (kept when the distance is ~0). */
  dirX: number;
  dirZ: number;
  readonly spinAxis: THREE.Vector3;
  spinAngle: number;
  spinSpeed: number;
}

const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const tmpPos = new THREE.Vector3();
const tmpMat = new THREE.Matrix4();
const tmpColor = new THREE.Color();
const tmpOffset = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** What the field needs to know about the camera: how far it is heading to be. Spawn distances are fractions of it. */
export interface ViewSource {
  readonly targetDistance: number;
}

/**
 * Prey: a fixed pool of rocks drawn as one InstancedMesh. What spawns comes from the current tier's absolute
 * prey table and entity budget (the first `tier.count` slots are live); spawn distances scale with the view.
 * Edible prey spaghettify: they stretch toward the hole as it gets close, and when eaten they fall in,
 * stretching into a thin spiralling stream that drains into the core (see preySpaghettify.pars.vert.glsl).
 */
export class PreyField {
  readonly mesh: THREE.InstancedMesh;
  readonly objects: PreyObject[] = [];
  /** Per instance: direction from the hole (x, z), stretch factor, curl. */
  private readonly stretchAttr: THREE.InstancedBufferAttribute;
  /** Per instance: tidal heating glow 0..1. */
  private readonly glowAttr: THREE.InstancedBufferAttribute;
  private readonly uniforms: PreyUniforms;

  private tier: Tier;

  constructor(
    private readonly player: Player,
    private readonly view: ViewSource,
    tier: Tier,
  ) {
    this.tier = tier;
    const geometry = createRockGeometry();
    this.stretchAttr = new THREE.InstancedBufferAttribute(new Float32Array(PREY_POOL_SIZE * 4), 4);
    this.stretchAttr.setUsage(THREE.DynamicDrawUsage);
    this.glowAttr = new THREE.InstancedBufferAttribute(new Float32Array(PREY_POOL_SIZE), 1);
    this.glowAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aStretch', this.stretchAttr);
    geometry.setAttribute('aGlow', this.glowAttr);

    const { material, uniforms } = createPreyMaterial();
    this.uniforms = uniforms;
    this.mesh = new THREE.InstancedMesh(geometry, material, PREY_POOL_SIZE);
    this.mesh.count = tier.count;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    for (let i = 0; i < PREY_POOL_SIZE; i++) {
      const obj: PreyObject = {
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        radius: 1,
        mass: 1,
        className: '',
        state: 'alive',
        appear: 1,
        eatProgress: 0,
        infallTime: 1,
        eatOffset: new THREE.Vector3(),
        infallWeight: 0,
        stretchFrom: 1,
        stretch: 1,
        dirX: 1,
        dirZ: 0,
        spinAxis: new THREE.Vector3(0, 1, 0),
        spinAngle: 0,
        spinSpeed: 0,
      };
      this.objects.push(obj);
      this.respawn(i, PREY.initialInner, PREY.initialOuter, false);
      this.writeInstance(i, obj);
    }
  }

  /** True if the player is big enough to eat this object. */
  isEdible(obj: PreyObject): boolean {
    return obj.radius < this.player.radius * PREY.edibleRatio;
  }

  /** 0..1: how big an edible object is for the player right now. Bigger prey spaghettify harder. */
  private sizeWeight(obj: PreyObject): number {
    return Math.min(1, obj.radius / (this.player.radius * PREY.edibleRatio)) ** SPAGHETTI.sizePower;
  }

  /** The live tier. Slots beyond the old budget join and leftovers too small for the new table are refilled across the view. */
  setTier(tier: Tier): void {
    const oldCount = this.tier.count;
    this.tier = tier;
    this.mesh.count = tier.count;
    const minRadius = tierMinRadius(tier);
    for (let i = 0; i < tier.count; i++) {
      const obj = this.objects[i];
      if (i >= oldCount || (obj.state === 'alive' && obj.radius < minRadius)) {
        this.respawn(i, PREY.initialInner, PREY.initialOuter, true);
        this.writeInstance(i, obj);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.stretchAttr.needsUpdate = true;
  }

  /** Start of a new run: refill the whole pool across the view from the given tier's table. */
  reset(tier: Tier): void {
    this.tier = tier;
    this.mesh.count = tier.count;
    for (let i = 0; i < PREY_POOL_SIZE; i++) {
      this.respawn(i, PREY.initialInner, PREY.initialOuter, false);
      this.writeInstance(i, this.objects[i]);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.stretchAttr.needsUpdate = true;
    this.glowAttr.needsUpdate = true;
  }

  update(dt: number): void {
    const player = this.player;
    const pr = player.radius;
    const view = this.view.targetDistance;
    const despawnSq = (PREY.despawnDistance * view) ** 2;
    const respawnSq = (PREY.respawnInner * view) ** 2;
    // Specks the player has outgrown are recycled once they are off screen.
    const staleRadius = pr * PREY.minRelSize;
    this.uniforms.uHole.value.set(player.position.x, player.position.z, pr);

    for (let i = 0; i < this.tier.count; i++) {
      const obj = this.objects[i];

      if (obj.state === 'eating') {
        obj.eatProgress += dt / obj.infallTime;
        if (obj.eatProgress >= 1) {
          this.respawn(i, PREY.respawnInner, PREY.respawnOuter, true);
        }
      } else {
        obj.position.addScaledVector(obj.velocity, dt);
        obj.appear = Math.min(1, obj.appear + dt / PREY.appearTime);

        const dx = obj.position.x - player.position.x;
        const dz = obj.position.z - player.position.z;
        const distSq = dx * dx + dz * dz;

        const outOfSight = distSq > respawnSq;
        if (distSq > despawnSq || (outOfSight && obj.radius < staleRadius)) {
          this.respawn(i, PREY.respawnInner, PREY.respawnOuter, true);
        } else if (player.canEat && this.isEdible(obj)) {
          const reach = pr + obj.radius * PREY.eatReach;
          if (distSq < reach * reach) {
            obj.state = 'eating';
            obj.eatProgress = 0;
            obj.eatOffset.subVectors(obj.position, player.position);
            obj.infallWeight = this.sizeWeight(obj);
            obj.infallTime = lerp(SPAGHETTI.infallTimeMin, SPAGHETTI.infallTimeMax, obj.infallWeight);
            obj.stretchFrom = obj.stretch;
            player.eat(obj.mass, { name: obj.className, radius: obj.radius });
          }
        }
      }

      obj.spinAngle += obj.spinSpeed * dt;
      this.writeInstance(i, obj);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.stretchAttr.needsUpdate = true;
    this.glowAttr.needsUpdate = true;
  }

  private writeInstance(i: number, obj: PreyObject): void {
    const player = this.player;
    let scale = obj.radius * smooth(obj.appear);
    let stretch = 1;
    let curl = 0;
    let glow = 0;

    if (obj.state === 'eating') {
      // Infall: the distance to the hole shrinks slowly then plunges, while the object swings
      // around the hole with the disk's spin. Stretch, curl and glow build up on the way in,
      // and the last part of the infall drains it into the core.
      const t = Math.min(obj.eatProgress, 1);
      const fall = t ** SPAGHETTI.accelPower;
      tmpOffset.copy(obj.eatOffset).applyAxisAngle(UP, DISK.spin * SPAGHETTI.swirl * fall);
      this.setDirection(obj, tmpOffset.x, tmpOffset.z);
      tmpPos.copy(player.position).addScaledVector(tmpOffset, 1 - fall);
      const build = 1 - (1 - t) * (1 - t);
      stretch = lerp(obj.stretchFrom, 1 + (SPAGHETTI.maxStretch - 1) * obj.infallWeight, build);
      curl = DISK.spin * SPAGHETTI.curl * obj.infallWeight * build;
      glow = t;
      scale *= 1 - smoothstep(SPAGHETTI.drainStart, 1, t);
    } else {
      tmpPos.copy(obj.position);
      const dx = obj.position.x - player.position.x;
      const dz = obj.position.z - player.position.z;
      this.setDirection(obj, dx, dz);
      // Tidal stretch on approach. Inedible (bigger) objects are inert for now.
      if (this.isEdible(obj)) {
        const gap = (Math.sqrt(dx * dx + dz * dz) - player.radius - obj.radius) / player.radius;
        const k = Math.min(1, Math.max(0, 1 - gap / SPAGHETTI.onsetGap));
        stretch = 1 + (SPAGHETTI.approachStretch - 1) * k * k * this.sizeWeight(obj);
      }
    }

    obj.stretch = stretch;
    this.stretchAttr.setXYZW(i, obj.dirX, obj.dirZ, stretch, curl);
    this.glowAttr.setX(i, glow);

    tmpQuat.setFromAxisAngle(obj.spinAxis, obj.spinAngle);
    tmpScale.setScalar(Math.max(scale, 1e-4));
    tmpMat.compose(tmpPos, tmpQuat, tmpScale);
    this.mesh.setMatrixAt(i, tmpMat);
  }

  /** Remember the direction from the hole to the object, unless they are on top of each other. */
  private setDirection(obj: PreyObject, dx: number, dz: number): void {
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 1e-6) return;
    obj.dirX = dx / len;
    obj.dirZ = dz / len;
  }

  /** Reuse pool slot i as a fresh object from the current tier's table in an annulus around the player (distances are in camera distances). */
  private respawn(i: number, innerRel: number, outerRel: number, animate: boolean): void {
    const obj = this.objects[i];
    const pr = this.player.radius;
    const view = this.view.targetDistance;

    const cls = this.pickClass(pr * PREY.minRelSize, obj);
    obj.className = cls.name;
    obj.mass = massOfRadius(obj.radius);
    obj.state = 'alive';
    obj.appear = animate ? 0 : 1;
    obj.eatProgress = 0;
    obj.stretch = 1;

    // Uniform over the annulus area. Keep clear of the player so spawning never overlaps it.
    const minDist = Math.max(innerRel * view, pr + obj.radius * 1.5);
    const maxDist = Math.max(outerRel * view, minDist + pr);
    const dist = Math.sqrt(minDist * minDist + Math.random() * (maxDist * maxDist - minDist * minDist));
    const angle = Math.random() * Math.PI * 2;
    obj.position.set(
      this.player.position.x + Math.cos(angle) * dist,
      0,
      this.player.position.z + Math.sin(angle) * dist,
    );

    const driftAngle = Math.random() * Math.PI * 2;
    const drift = Math.random() * PREY.driftSpeed * view;
    obj.velocity.set(Math.cos(driftAngle) * drift, 0, Math.sin(driftAngle) * drift);

    obj.spinAxis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
    if (obj.spinAxis.lengthSq() < 1e-4) obj.spinAxis.set(0, 1, 0);
    obj.spinAxis.normalize();
    obj.spinAngle = Math.random() * Math.PI * 2;
    obj.spinSpeed = (Math.random() * 2 - 1) * PREY.spinSpeed;

    const { hue, sat, light } = cls.color;
    tmpColor.setHSL(
      lerp(hue[0], hue[1], Math.random()),
      lerp(sat[0], sat[1], Math.random()),
      lerp(light[0], light[1], Math.random()),
    );
    this.mesh.setColorAt(i, tmpColor);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /**
   * Draw a class by weight and a radius within it, and store the radius on `obj`. Samples below
   * `minRadius` (specks next to the current player) are redrawn a few times so the screen stays full of useful prey.
   */
  private pickClass(minRadius: number, obj: PreyObject): PreyClass {
    const classes = this.tier.classes;
    let total = 0;
    for (const c of classes) total += c.weight;
    let cls = classes[0];
    for (let attempt = 0; attempt < 8; attempt++) {
      let roll = Math.random() * total;
      cls = classes[classes.length - 1];
      for (const c of classes) {
        roll -= c.weight;
        if (roll <= 0) {
          cls = c;
          break;
        }
      }
      obj.radius = logUniform(cls.radius[0], cls.radius[1]);
      if (obj.radius >= minRadius) break;
    }
    return cls;
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  return smooth(Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0))));
}

function logUniform(min: number, max: number): number {
  return Math.exp(lerp(Math.log(min), Math.log(max), Math.random()));
}

/** Lumpy unit rock. Displacement is a pure function of position, so duplicated vertices stay welded. */
function createRockGeometry(): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, PREY.meshDetail);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const n =
      Math.sin(v.x * 3.1 + 1.3) * Math.sin(v.y * 2.7 + 0.4) * Math.sin(v.z * 3.3 + 2.1) +
      0.5 * Math.sin(v.x * 7.3 + v.y * 5.1 + 0.7) * Math.sin(v.z * 6.1 + v.x * 2.3);
    v.multiplyScalar(1 + PREY.roughness * n);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}
