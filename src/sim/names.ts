import { HOLE_NAMES } from '../config/index.ts';
import type { Rng } from './rng.ts';

function pick<T>(rng: Rng, list: readonly T[]): T {
  return list[Math.floor(rng.next() * list.length) % list.length];
}

/**
 * An on-theme hole name: "Silent Quasar" or a real star or physicist with a number ("Kerr-7"). Tries a few times
 * for one `taken` does not already use, then adds a number to make it unique.
 */
export function generateName(rng: Rng, taken: (name: string) => boolean): string {
  let name = '';
  for (let attempt = 0; attempt < 12; attempt++) {
    name =
      rng.next() < HOLE_NAMES.properChance
        ? `${pick(rng, HOLE_NAMES.proper)}-${1 + Math.floor(rng.next() * 99)}`
        : `${pick(rng, HOLE_NAMES.first)} ${pick(rng, HOLE_NAMES.second)}`;
    if (!taken(name)) return name;
  }
  for (let n = 2; ; n++) if (!taken(`${name} ${n}`)) return `${name} ${n}`;
}
