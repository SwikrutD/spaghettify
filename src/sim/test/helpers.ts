import type { Body } from '../body.ts';
import type { SimEvent } from '../events.ts';
import { massOfRadius, type Hole } from '../Hole.ts';
import { World } from '../World.ts';

/**
 * A world with nothing near the hole: the small-matter field is off, and every body is sent out of the arena so
 * one step respawns it out of sight of the hole. The hole sits at the origin.
 */
export function calmWorld(seed: number): World {
  const world = new World({ seed });
  world.field.enabled = false;
  for (const obj of world.prey.objects) obj.position.x += 1e6;
  world.step();
  world.clearEvents();
  return world;
}

/** Send every body away: one step respawns each out of sight of the holes as they are now (after growing one, say). */
export function clearBodies(world: World): void {
  for (const obj of world.prey.objects) obj.position.x += 1e6;
  world.step();
  world.clearEvents();
}

/** No comet for the next while (every hole waits the first-comet delay again). */
export function holdComets(world: World): void {
  world.comets.reset();
}

/** Step for `seconds`, calling `each` before every step. Returns the events of those steps, oldest first. */
export function run(world: World, seconds: number, each?: () => void): SimEvent[] {
  const events: SimEvent[] = [];
  const steps = Math.round(seconds / world.dt);
  for (let i = 0; i < steps; i++) {
    each?.();
    world.step();
    events.push(...world.events);
    world.clearEvents();
  }
  return events;
}

/** One step; returns its events. */
export function step(world: World): SimEvent[] {
  return run(world, world.dt);
}

/** Make arena body slot `i` a still, live body of `radius` at (x, z). */
export function placeBody(world: World, i: number, radius: number, x: number, z: number): Body {
  const body = world.prey.objects[i];
  body.state = 'alive';
  body.radius = radius;
  body.mass = massOfRadius(radius);
  body.position.x = x;
  body.position.z = z;
  body.velocity.x = body.velocity.z = 0;
  return body;
}

/** Set a hole's mass and snap its radius to match (no growth animation). */
export function setMass(hole: Hole, mass: number): void {
  hole.mass = mass;
  hole.radius = hole.radiusForMass();
}

/** Distance between centres on the play plane. */
export function distance(a: { position: { x: number; z: number } }, b: { position: { x: number; z: number } }): number {
  return Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
}

/** A cheap fingerprint of a big typed array (equal arrays, equal values; different ones almost surely differ). */
function checksum(a: ArrayLike<number>): number {
  let h = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== 0) h = (Math.imul(h ^ i, 0x9e3779b1) + Math.round(a[i] * 1000)) | 0;
  return h;
}

/** Everything that makes up the world's state, as one string (equal strings mean equal worlds). */
export function digest(world: World): string {
  return JSON.stringify({
    tick: world.tick,
    time: world.time,
    rng: world.rng.state,
    holes: world.holes.map((h) => ({
      id: h.id,
      name: h.name,
      gen: h.gen,
      protection: h.protection,
      eatenBy: h.eatenBy,
      holesEaten: h.holesEaten,
      brain: h.bot,
      input: h.input,
      position: h.position,
      velocity: h.velocity,
      pull: h.pull,
      radius: h.radius,
      mass: h.mass,
      peak: h.peakMass,
      eatenMass: h.eatenMass,
      eatenCount: h.eatenCount,
      biggest: h.biggestEaten,
      stun: h.stun,
      invulnerable: h.invulnerable,
      hits: h.hits,
      shedMass: h.shedMass,
      milestone: h.milestone,
      shrink: h.shrink,
      comet: h.cometTimer,
      hunger: [h.hunger.phase, h.hunger.idle, h.hunger.runTime, h.hunger.level],
    })),
    field: world.field.layers.map((l) => [checksum(l.taken), checksum(l.epoch), checksum(l.regrowAt), l.waiting]),
    infall: world.field.infall,
    prey: world.prey.objects,
    comets: world.comets.objects,
    debris: world.debris.objects,
  });
}
