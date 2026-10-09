import * as THREE from 'three';
import { DANGER, PREY, PREY_POOL_SIZE, tierMinRadius, type PreyClass, type Tier } from '../config';
import { massOfRadius, type Player } from '../player/Player';
import { beginInfall, canSwallow, createPreyObject, lerp, logUniform, PreyMesh, randomSpin, type PreyObject } from './PreyMesh';

export type { PreyObject, PreyState } from './PreyMesh';

const tmpColor = new THREE.Color();

/** What the field needs to know about the camera: how far it is heading to be. Spawn distances are fractions of it. */
export interface ViewSource {
  readonly targetDistance: number;
}

/**
 * Prey: a fixed pool of bodies drawn as two InstancedMeshes over the same slots (see PreyMesh), lumpy rocks
 * and smooth round bodies (planets, moons); each slot is drawn in the mesh of its shape and hidden in the other. What spawns comes from the current
 * tier's absolute prey table and entity budget (the first `tier.count` slots are live); spawn distances
 * scale with the view. Edible prey spaghettify when eaten. Bodies never overlap each other: overlapping
 * pairs are pushed apart, and spawns avoid other bodies and keep big ones out of pull reach of the hole.
 */
export class PreyField {
  readonly objects: PreyObject[] = [];
  /** Both meshes; add this to the scene. */
  readonly group = new THREE.Group();
  private readonly rocks = new PreyMesh(PREY_POOL_SIZE, 'rock');
  private readonly spheres = new PreyMesh(PREY_POOL_SIZE, 'sphere');
  private tier: Tier;

  constructor(
    private readonly player: Player,
    private readonly view: ViewSource,
    tier: Tier,
  ) {
    this.tier = tier;
    this.group.add(this.rocks.mesh, this.spheres.mesh);
    this.setCount(tier.count);
    for (let i = 0; i < PREY_POOL_SIZE; i++) {
      const obj = createPreyObject();
      this.objects.push(obj);
      this.respawn(i, PREY.initialInner, PREY.initialOuter, false);
      this.write(i);
    }
    this.commit();
  }

  /** The mesh slot i is drawn in (its instance index is i). */
  meshOf(i: number): THREE.InstancedMesh {
    return (this.objects[i].round ? this.spheres : this.rocks).mesh;
  }

  /** Live slots (the current tier's entity budget). */
  get liveCount(): number {
    return this.tier.count;
  }

  /** True if the player is big enough to eat this object. */
  isEdible(obj: PreyObject): boolean {
    return canSwallow(obj.radius, this.player.radius);
  }

  /** The live tier. Slots beyond the old budget join and leftovers too small for the new table are refilled across the view. */
  setTier(tier: Tier): void {
    const oldCount = this.tier.count;
    this.tier = tier;
    this.setCount(tier.count);
    const minRadius = tierMinRadius(tier);
    for (let i = 0; i < tier.count; i++) {
      const obj = this.objects[i];
      if (i >= oldCount || (obj.state === 'alive' && obj.radius < minRadius)) {
        this.respawn(i, PREY.initialInner, PREY.initialOuter, true);
        this.write(i);
      }
    }
    this.commit();
  }

  /** Start of a new run: refill the whole pool across the view from the given tier's table. */
  reset(tier: Tier): void {
    this.tier = tier;
    this.setCount(tier.count);
    // Park everything far away first so the refill does not dodge the last run's bodies.
    for (const obj of this.objects) obj.position.set(1e9, 0, 1e9);
    for (let i = 0; i < PREY_POOL_SIZE; i++) {
      this.respawn(i, PREY.initialInner, PREY.initialOuter, false);
      this.write(i);
    }
    this.commit();
  }

  update(dt: number): void {
    const player = this.player;
    const pr = player.radius;
    const view = this.view.targetDistance;
    const despawnSq = (PREY.despawnDistance * view) ** 2;
    const respawnSq = (PREY.respawnInner * view) ** 2;
    // Specks the player has outgrown are recycled once they are off screen.
    const staleRadius = pr * PREY.minRelSize;
    this.rocks.setHole(player);
    this.spheres.setHole(player);

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
          if (distSq < reach * reach) beginInfall(obj, player);
        }
      }
      obj.spinAngle += obj.spinSpeed * dt;
    }

    this.separate(dt);
    for (let i = 0; i < this.tier.count; i++) this.write(i);
    this.commit();
  }

  /** Draw slot i in the mesh of its shape and hide it in the other. */
  private write(i: number): void {
    const obj = this.objects[i];
    (obj.round ? this.spheres : this.rocks).write(i, obj, this.player);
    (obj.round ? this.rocks : this.spheres).hide(i);
  }

  private commit(): void {
    this.rocks.commit();
    this.spheres.commit();
  }

  private setCount(count: number): void {
    this.rocks.mesh.count = count;
    this.spheres.mesh.count = count;
  }

  /** Push overlapping live bodies apart, the lighter one moving more. O(n^2) over at most PREY_POOL_SIZE bodies, no allocations. */
  private separate(dt: number): void {
    const k = Math.min(1, DANGER.separationRate * dt);
    const n = this.tier.count;
    for (let i = 0; i < n; i++) {
      const a = this.objects[i];
      if (a.state !== 'alive') continue;
      for (let j = i + 1; j < n; j++) {
        const b = this.objects[j];
        if (b.state !== 'alive') continue;
        const dx = b.position.x - a.position.x;
        const dz = b.position.z - a.position.z;
        const min = (a.radius + b.radius) * DANGER.bodyPad;
        const distSq = dx * dx + dz * dz;
        if (distSq >= min * min) continue;
        const dist = Math.sqrt(distSq);
        // Exactly on top of each other: pick any direction.
        const nx = dist > 1e-6 ? dx / dist : 1;
        const nz = dist > 1e-6 ? dz / dist : 0;
        const push = (min - dist) * k;
        const wa = b.mass / (a.mass + b.mass);
        a.position.x -= nx * push * wa;
        a.position.z -= nz * push * wa;
        b.position.x += nx * push * (1 - wa);
        b.position.z += nz * push * (1 - wa);
      }
    }
  }

  /** Reuse pool slot i as a fresh object from the current tier's table in an annulus around the player (distances are in camera distances). */
  private respawn(i: number, innerRel: number, outerRel: number, animate: boolean): void {
    const obj = this.objects[i];
    const player = this.player;
    const pr = player.radius;
    const view = this.view.targetDistance;

    const cls = this.pickClass(pr * PREY.minRelSize, obj);
    obj.className = cls.name;
    obj.round = cls.round ?? false;
    obj.mass = massOfRadius(obj.radius);
    obj.state = 'alive';
    obj.appear = animate ? 0 : 1;
    obj.eatProgress = 0;
    obj.stretch = 1;

    // Uniform over the annulus area. Keep clear of the player so spawning never overlaps it, and keep bodies
    // the hole cannot eat out of their pull reach where the annulus allows (huge ones end up at its outer edge).
    const outer = outerRel * view;
    let clear = pr + obj.radius * 1.5;
    if (!this.isEdible(obj)) clear = Math.max(clear, Math.min(outer, obj.radius * DANGER.pullReach + pr * (1 + DANGER.spawnClearance)));
    const minDist = Math.max(innerRel * view, clear);
    const maxDist = Math.max(outer, minDist + pr);
    // A few tries to land clear of the other bodies; the separation pass sorts out the rare miss.
    for (let attempt = 0; attempt < DANGER.spawnTries; attempt++) {
      const dist = Math.sqrt(minDist * minDist + Math.random() * (maxDist * maxDist - minDist * minDist));
      const angle = Math.random() * Math.PI * 2;
      obj.position.set(player.position.x + Math.cos(angle) * dist, 0, player.position.z + Math.sin(angle) * dist);
      if (!this.overlapsOther(i)) break;
    }

    const driftAngle = Math.random() * Math.PI * 2;
    const drift = Math.random() * PREY.driftSpeed * view;
    obj.velocity.set(Math.cos(driftAngle) * drift, 0, Math.sin(driftAngle) * drift);
    randomSpin(obj);

    const { hue, sat, light } = cls.color;
    tmpColor.setHSL(
      lerp(hue[0], hue[1], Math.random()),
      lerp(sat[0], sat[1], Math.random()),
      lerp(light[0], light[1], Math.random()),
    );
    this.rocks.setColor(i, tmpColor);
    this.spheres.setColor(i, tmpColor);
  }

  /** True if slot i overlaps another live body (other slots that exist yet). */
  private overlapsOther(i: number): boolean {
    const a = this.objects[i];
    const n = Math.min(this.tier.count, this.objects.length);
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const b = this.objects[j];
      if (b.state !== 'alive') continue;
      const min = (a.radius + b.radius) * DANGER.bodyPad;
      const dx = b.position.x - a.position.x;
      const dz = b.position.z - a.position.z;
      if (dx * dx + dz * dz < min * min) return true;
    }
    return false;
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
