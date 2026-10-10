import { BODIES, FIELD, MILESTONES, PREY, type PreyClass } from '../config/index.ts';
import { holeMassForRadius } from './Hole.ts';

/** Every class in the arena, smallest first: the procedural field's layers, then the individual bodies. */
export const ARENA_CLASSES: readonly PreyClass[] = [...FIELD.layers, ...BODIES.classes];

/** The class of this name. Throws on a typo in the config. */
export function classNamed(name: string): PreyClass {
  const cls = ARENA_CLASSES.find((c) => c.name === name);
  if (!cls) throw new Error(`unknown class "${name}"`);
  return cls;
}

/** Mass at which each milestone is reached: the hole can then swallow the largest member of the class it unlocks. */
export const MILESTONE_MASSES: readonly number[] = MILESTONES.map((m) =>
  m.unlocks ? holeMassForRadius(classNamed(m.unlocks).radius[1] / PREY.edibleRatio) : 0,
);

/** Index of the highest milestone this mass has reached. */
export function milestoneIndexForMass(mass: number): number {
  let index = 0;
  for (let i = 1; i < MILESTONE_MASSES.length; i++) if (mass >= MILESTONE_MASSES[i]) index = i;
  return index;
}
