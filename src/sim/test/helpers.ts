import { TIERS } from '../../config/index.ts';
import type { Body } from '../body.ts';
import type { SimEvent } from '../events.ts';
import { massOfRadius, type Hole } from '../Hole.ts';
import { World } from '../World.ts';

/**
 * A world with the prey field sent away: one step respawns every body on the ring off screen, and bodies the
 * hole cannot eat land out of their pull reach. The hole sits at the origin with nothing near it.
 */
export function calmWorld(seed: number): World {
  const world = new World({ seed });
  for (const obj of world.prey.objects) obj.position.x += 1e6;
  world.step();
  world.clearEvents();
  return world;
}

/** No comet for the next while (restarts the tier's first-comet delay). */
export function holdComets(world: World): void {
  world.comets.reset(TIERS[world.focus.tier]);
}

/** Step for `seconds` of real time, calling `each` before every step. Returns the events of those steps, oldest first. */
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

/** Make prey slot `i` a still, live body of `radius` at (x, z). */
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

/** Everything that makes up the world's state, as one string (equal strings mean equal worlds). */
export function digest(world: World): string {
  return JSON.stringify({
    tick: world.tick,
    rng: world.rng.state,
    timeScale: world.timeScale,
    holes: world.holes.map((h) => ({
      id: h.id,
      position: h.position,
      velocity: h.velocity,
      pull: h.pull,
      radius: h.radius,
      mass: h.mass,
      eatenMass: h.eatenMass,
      eatenCount: h.eatenCount,
      biggest: h.biggestEaten,
      stun: h.stun,
      invulnerable: h.invulnerable,
      hits: h.hits,
      shedMass: h.shedMass,
      tier: h.tier,
      shrink: h.shrink,
      view: [h.view.radiusDistance, h.view.tierScale, h.view.tierScaleTarget],
      hunger: [h.hunger.phase, h.hunger.idle, h.hunger.runTime, h.hunger.level, h.hunger.peakMass],
    })),
    prey: world.prey.objects,
    comets: world.comets.objects,
    debris: world.debris.objects,
  });
}
