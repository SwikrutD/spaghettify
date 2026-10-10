import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIELD, PREY } from '../../config/index.ts';
import type { AteEvent, SimEvent } from '../events.ts';
import { holeMassForRadius, massOfRadius, viewDistance } from '../Hole.ts';
import type { Grain } from '../MatterField.ts';
import { World } from '../World.ts';
import { holdComets, run, setMass, step } from './helpers.ts';

const ate = (events: SimEvent[]) => events.filter((e): e is AteEvent => e.type === 'ate');
const DUST = 0;
const PEBBLE = 1;
const ASTEROID = FIELD.layers.findIndex((l) => l.name === 'asteroid');

/** Every live grain of a layer within `radius` of (x, z), copied out. */
function grains(world: World, layer: number, x: number, z: number, radius: number): Grain[] {
  const out: Grain[] = [];
  world.field.forEach(layer, x, z, radius, 0, (g) => void out.push({ ...g }));
  return out;
}

/** A world with no bodies anywhere near the origin and comets held back: only the field. */
function fieldWorld(seed: number): World {
  const world = new World({ seed });
  for (const obj of world.prey.objects) obj.position.x += 1e6;
  // Respawning them all at once leaves a few overlapping: let them push apart.
  run(world, 0.5, () => holdComets(world));
  holdComets(world);
  return world;
}

test('the field is the same for the same seed, different for another, and fills the arena at its density', () => {
  const a = new World({ seed: 51 });
  const b = new World({ seed: 51 });
  const c = new World({ seed: 52 });
  const ga = grains(a, PEBBLE, 300, -200, 40);
  assert.deepEqual(grains(b, PEBBLE, 300, -200, 40), ga);
  assert.notDeepEqual(grains(c, PEBBLE, 300, -200, 40), ga);
  // Density: about grid^2 x fill grains per cell area, at a few spots across the arena with no body on them.
  const clear = [[300, -200], [-800, 600], [500, 500], [-300, -700], [0, 900], [900, 0]].filter(([x, z]) =>
    a.prey.objects.every((o) => Math.hypot(o.position.x - x, o.position.z - z) > 60 + o.radius),
  );
  assert.ok(clear.length >= 2);
  for (const [x, z] of clear) {
    const layer = FIELD.layers[PEBBLE];
    const expected = ((layer.grid * layer.grid * layer.fill) / (layer.cell * layer.cell)) * Math.PI * 60 * 60;
    const n = grains(a, PEBBLE, x, z, 60).length;
    assert.ok(n > expected * 0.75 && n < expected * 1.25, `${n} vs ${expected}`);
  }
  // Grains never overlap within a layer, and every one is inside its class's size range.
  const g = grains(a, DUST, 0, 0, 30);
  for (const p of g) assert.ok(p.radius >= FIELD.layers[DUST].radius[0] && p.radius <= FIELD.layers[DUST].radius[1]);
  for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) assert.ok(Math.hypot(g[i].x - g[j].x, g[i].z - g[j].z) > g[i].radius + g[j].radius);
});

test('a pea eats the dust it touches: a meal each, a falling body that spaghettifies, and the grain is gone', () => {
  const world = fieldWorld(53);
  const hole = world.focus;
  hole.hunger.enabled = false;
  const target = grains(world, DUST, 4, 4, 3)[0];
  assert.ok(target);
  hole.position.x = target.x;
  hole.position.z = target.z;
  const mass = hole.mass;
  const meals = ate(step(world));
  assert.ok(meals.length >= 1);
  const meal = meals.find((m) => m.what?.radius === target.radius)!;
  assert.equal(meal.what!.name, 'dust grain');
  assert.ok(hole.mass > mass + massOfRadius(target.radius) * 0.999);
  // Gone from the field, and falling in as a pooled body with the grain's look.
  assert.equal(grains(world, DUST, target.x, target.z, 0.01).length, 0);
  const falling = world.field.infall.find((b) => b.active && b.seed === target.seed)!;
  assert.ok(falling);
  assert.equal(falling.state, 'eating');
  assert.equal(falling.eaterId, hole.id);
  run(world, 1);
  assert.equal(falling.active, false);
});

test('a big hole swallows specks on the way with no meal; grains too big to eat block a small hole', () => {
  const world = fieldWorld(54);
  const big = world.focus;
  big.hunger.enabled = false;
  world.dangers.enabled = false;
  setMass(big, holeMassForRadius(5));
  assert.ok(FIELD.layers[DUST].radius[1] < big.radius * PREY.minRelSize);
  const dust = grains(world, DUST, 0, 0, big.radius).length;
  assert.ok(dust > 10);
  const mass = big.mass;
  const count = big.eatenCount;
  const events = step(world);
  assert.equal(grains(world, DUST, 0, 0, big.radius * 0.9).length, 0);
  assert.ok(big.mass > mass);
  // Pebbles may count as meals for it; dust never does.
  assert.ok(ate(events).every((e) => e.what?.name !== 'dust grain'));
  assert.ok(big.eatenCount - count <= ate(events).length);

  // A pea parked against an asteroid grain: pushed out and hit.
  const world2 = fieldWorld(55);
  const pea = world2.focus;
  pea.hunger.enabled = false;
  const rock = grains(world2, ASTEROID, 0, 0, 400)[0];
  pea.position.x = rock.x + rock.radius + pea.radius * 0.5;
  pea.position.z = rock.z;
  const hit = step(world2).filter((e) => e.type === 'bumped');
  assert.equal(hit.length, 1);
  assert.ok(Math.hypot(pea.position.x - rock.x, pea.position.z - rock.z) >= rock.radius + pea.radius);
});

test('an eaten cell grows back laid out afresh, but only once no hole is near', () => {
  const world = fieldWorld(56);
  const hole = world.focus;
  hole.hunger.enabled = false;
  world.dangers.enabled = false;
  // Clear a patch of pebbles right at the hole.
  world.field.clearAround(0, 0, 20);
  assert.equal(grains(world, PEBBLE, 0, 0, 20).length, 0);
  // Well past the longest regrow time with the hole sitting there: still bare.
  run(world, FIELD.regrowTime[1] + 5, () => holdComets(world));
  assert.equal(grains(world, PEBBLE, 0, 0, 15).length, 0);
  // The hole leaves: within a few retries the patch is back (a new layout, scaling in).
  hole.position.x = 700;
  const time = world.time;
  run(world, FIELD.regrowRetry * 2 + 1, () => holdComets(world));
  const back = grains(world, PEBBLE, 0, 0, 15);
  assert.ok(back.length > 3);
  assert.ok(back.every((g) => g.born > time));
  assert.ok(FIELD.regrowClearViews * viewDistance(hole.radius) < 700);
});

test('bodies cover the grains under them; when the body is eaten they grow back in time', () => {
  const world = fieldWorld(57);
  const hole = world.focus;
  hole.hunger.enabled = false;
  world.dangers.enabled = false;
  for (const body of world.prey.objects) {
    if (body.state !== 'alive') continue;
    for (let layer = 0; layer < FIELD.layers.length; layer++) {
      assert.equal(grains(world, layer, body.position.x, body.position.z, body.radius * 0.9).length, 0, body.className);
    }
  }
  // Feed one body (one clear of the others) to the hole: once the hole is gone from there, its patch fills in.
  const objects = world.prey.objects;
  const body = objects.find((a) => objects.every((b) => b === a || Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) > (a.radius + b.radius) * 1.5))!;
  const x = body.position.x;
  const z = body.position.z;
  const r = body.radius;
  setMass(hole, holeMassForRadius(r * 1.2));
  hole.position.x = x;
  hole.position.z = z;
  step(world);
  assert.equal(body.state, 'eating');
  hole.position.x = -x;
  hole.position.z = -z;
  setMass(hole, hole.startMass);
  run(world, FIELD.regrowTime[1] + FIELD.regrowRetry * 2, () => holdComets(world));
  assert.ok(grains(world, DUST, x, z, r * 0.8).length > 3);
});
