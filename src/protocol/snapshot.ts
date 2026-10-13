// Snapshots: what the server tells a client about the arena around it, NET.snapshotRate times a second (binary,
// little-endian). The server writes only what is near the client (interest management, server/src/arena/Interest.ts)
// and, apart from the holes, only what changed since the last snapshot that client got: bodies, comets, debris and
// falling grains are sent when they enter its area or change (spawn, start falling in, leave), and in between the
// client moves them itself with the same rules (comets fly straight, debris slows by its drag, a fall runs on its
// clock); the procedural field is sent as the cells that differ from what the seed lays out. Pure, erasable
// TypeScript shared with the game.
//
// Layout:
//   u8 BINARY.snapshot, u32 tick, u32 ack (last input seq applied), u16 unit (log-packed: world units per step of a
//   nearby hole's offset from yours), u8 sections (SECTION bits),
//   you: your own hole at full precision (for prediction; its place is the centre the other holes are offset from),
//   holes: every other hole near you, every time, then, when present: gone (hole ids no longer sent), bodies,
//   rects, cells, events.
//
// The field: per synced layer the server keeps a rectangle of cells (`rects`, inclusive, in the layer's column and
// row numbers; c1 < c0 means the layer is not synced). Every cell inside the rectangle is exactly as the client
// was told: a cell never mentioned is as the seed laid it out (taken 0, epoch 0). When a rectangle moves, the
// client resets the cells that enter it to that pristine state and then applies the cell records, which list every
// entering cell that differs and every cell inside that changed. Cells outside the rectangle are unknown (off
// screen). A cell, once changed, never goes back to pristine, so this stays exact.
import type { Body } from '../sim/body.ts';
import type { SimEvent } from '../sim/events.ts';
import type { Hole, Meal } from '../sim/Hole.ts';
import type { RunPhase } from '../sim/Hunger.ts';
import { ARENA_CLASSES } from '../sim/milestones.ts';
import { BINARY } from './messages.ts';
import { SIM } from '../config/index.ts';
import { packLog, packSteps, packTimer, packUnit, Reader, unpackLog, unpackSteps, unpackTimer, unpackUnit, type Writer } from './wire.ts';

/** Seconds per sim step (the own hole's timers are sent in steps). */
const STEP = 1 / SIM.tickRate;

/** Kinds of pooled body a body record is about; `slot` indexes that pool (the same size on every side). */
export const BODY_KIND = {
  /** world.prey.objects: dwarf planets and up. */
  prey: 0,
  /** world.comets.objects */
  comet: 1,
  /** world.debris.objects */
  debris: 2,
  /** world.field.infall: an eaten grain falling into its hole. */
  infall: 3,
} as const;
export type BodyKind = (typeof BODY_KIND)[keyof typeof BODY_KIND];

/** Optional sections of a snapshot, one bit each. */
export const SECTION = { gone: 1, bodies: 2, rects: 4, cells: 8, events: 16 } as const;

const PHASES: readonly RunPhase[] = ['playing', 'evaporating', 'eaten', 'over'];
const HOLE_INTRO = 4;
const HOLE_WIDE = 8;
const HOLE_TIMERS = 16;
const HOLE_EATEN = 32;
/** Body record states. */
const REMOVED = 0;
const ALIVE = 1;
const EATING = 2;
/** Event types. */
const EV = { ate: 1, bumped: 2, shed: 3, milestone: 4, holeEaten: 5, died: 6 } as const;
const BUMP_BY = ['body', 'comet', 'hole'] as const;
/** What meals are called (the arena classes, comets and debris): an index each, so most 'ate' events carry no text. */
const MEAL_NAMES: readonly string[] = [...ARENA_CLASSES.map((c) => c.name), 'comet', 'debris'];

/** Your own hole, at full precision. */
export interface NetYou {
  gen: number;
  phase: RunPhase;
  x: number;
  z: number;
  vx: number;
  vz: number;
  pullX: number;
  pullZ: number;
  radius: number;
  mass: number;
  eatenMass: number;
  /** 0..1 hunger warning. */
  hunger: number;
  stun: number;
  invulnerable: number;
  protection: number;
  shrink: number;
  /** While being swallowed: as in NetHole. */
  eatenBy: number;
  eatProgress: number;
  eatOffsetX: number;
  eatOffsetZ: number;
}

/** Another hole near you, as drawn. */
export interface NetHole {
  id: number;
  /** Set when this record introduces the hole or a new life of it (otherwise null: as last introduced). */
  gen: number | null;
  name: string | null;
  x: number;
  z: number;
  radius: number;
  mass: number;
  eatenMass: number;
  phase: RunPhase;
  /** 0..1 hunger warning (the disk dims). */
  hunger: number;
  invulnerable: number;
  protection: number;
  /** While being swallowed: who by (-1 otherwise), how far (0..1), and its offset from the eater when it was. */
  eatenBy: number;
  eatProgress: number;
  eatOffsetX: number;
  eatOffsetZ: number;
}

/** A pooled body entering your area or changing (state null: forget it). */
export interface NetBody {
  kind: BodyKind;
  slot: number;
  state: 'alive' | 'eating' | null;
  gen: number;
  x: number;
  z: number;
  radius: number;
  seed: number;
  /** Prey: 0..1 scale-in. */
  appear: number;
  /** Comets and debris. */
  vx: number;
  vz: number;
  /** Comet: 0..1 tail brightness. */
  fade: number;
  /** Debris: seconds since thrown, mass, and the hole that shed it. */
  age: number;
  mass: number;
  ownerId: number;
  /** Falling grain: its field layer. */
  layer: number;
  /** While eating: the hole it falls into, progress, offset from it when eaten, size weight and fall time. */
  eaterId: number;
  eatProgress: number;
  eatOffsetX: number;
  eatOffsetZ: number;
  infallWeight: number;
  infallTime: number;
}

/** A field layer's synced rectangle of cells (inclusive; c1 < c0: not synced). */
export interface NetRect {
  layer: number;
  c0: number;
  r0: number;
  c1: number;
  r1: number;
}

export interface NetCell {
  layer: number;
  cell: number;
  taken: number;
  epoch: number;
}

export interface Snapshot {
  tick: number;
  ack: number;
  unit: number;
  you: NetYou;
  holes: NetHole[];
  gone: number[];
  bodies: NetBody[];
  rects: NetRect[];
  cells: NetCell[];
  events: SimEvent[];
}

/** The offset step a snapshot can carry for a wanted step: what the client will decode (log-packed). */
export function snapshotUnit(unit: number): number {
  return unpackLog(packLog(unit));
}

/**
 * Start a snapshot. `unit` must come from snapshotUnit (the hole records use it as is). Returns where the sections
 * byte is (patch it once the sections are written).
 */
export function writeHeader(w: Writer, tick: number, ack: number, unit: number): number {
  w.u8(BINARY.snapshot);
  w.u32(tick);
  w.u32(ack);
  w.u16(packLog(unit));
  const at = w.length;
  w.u8(0);
  return at;
}

/** Your own hole. Its place, as sent (float32), is the centre the other holes' offsets are from: see youCentre. */
export function writeYou(w: Writer, hole: Hole): void {
  const eaten = hole.eatenBy >= 0 && hole.phase === 'eaten';
  w.varint(hole.gen);
  w.u8(PHASES.indexOf(hole.phase) | (eaten ? HOLE_EATEN : 0));
  w.f32(hole.position.x);
  w.f32(hole.position.z);
  w.f32(hole.velocity.x);
  w.f32(hole.velocity.z);
  w.f32(hole.pull.x);
  w.f32(hole.pull.z);
  w.f32(hole.radius);
  w.f32(hole.mass);
  w.u16(packLog(hole.eatenMass));
  w.u8(packUnit(hole.hunger.level));
  // The timers to the step (the client predicts with them).
  w.u8(packSteps(hole.stun, STEP));
  w.u8(packSteps(hole.invulnerable, STEP));
  w.u8(packSteps(hole.protection, STEP));
  w.u8(packSteps(hole.shrink, STEP));
  if (eaten) writeEaten(w, hole);
}

/** The centre other holes are offset from: your hole's place as the client decodes it. */
export function youCentre(hole: Hole): { x: number; z: number } {
  return { x: Math.fround(hole.position.x), z: Math.fround(hole.position.z) };
}

function writeEaten(w: Writer, hole: Hole): void {
  w.varint(hole.eatenBy + 1);
  w.u8(packUnit(hole.eatProgress));
  w.f32(hole.eatOffset.x);
  w.f32(hole.eatOffset.z);
}

/** A hole record. Its place is an offset from (cx, cz) in steps of `unit`, or a plain position when too far for that. */
export function writeHole(w: Writer, hole: Hole, intro: boolean, cx: number, cz: number, unit: number): void {
  const ox = Math.round((hole.position.x - cx) / unit);
  const oz = Math.round((hole.position.z - cz) / unit);
  const wide = Math.abs(ox) > 32767 || Math.abs(oz) > 32767;
  const timers = hole.invulnerable > 0 || hole.protection > 0;
  const eaten = hole.eatenBy >= 0 && hole.phase === 'eaten';
  w.varint(hole.id);
  w.u8(PHASES.indexOf(hole.phase) | (intro ? HOLE_INTRO : 0) | (wide ? HOLE_WIDE : 0) | (timers ? HOLE_TIMERS : 0) | (eaten ? HOLE_EATEN : 0));
  if (intro) {
    w.varint(hole.gen);
    w.string(hole.name);
  }
  if (wide) {
    w.f32(hole.position.x);
    w.f32(hole.position.z);
  } else {
    w.i16(ox);
    w.i16(oz);
  }
  w.u16(packLog(hole.radius));
  w.u16(packLog(hole.mass));
  w.u16(packLog(hole.eatenMass));
  w.u8(packUnit(hole.hunger.level));
  if (timers) {
    w.u8(packTimer(hole.invulnerable));
    w.u8(packTimer(hole.protection));
  }
  if (eaten) writeEaten(w, hole);
}

/** The extra state some pooled bodies carry (comets, debris fragments, falling grains). */
export interface BodyExtras {
  fade?: number;
  age?: number;
  ownerId?: number;
  layer?: number;
}

/** A body record: the whole state of a pooled body that entered the client's area or changed. */
export function writeBody(w: Writer, kind: BodyKind, slot: number, body: Body & BodyExtras): void {
  const eating = body.state === 'eating';
  w.u8(kind | ((eating ? EATING : ALIVE) << 2));
  w.varint(slot);
  w.varint(body.gen);
  w.f32(body.position.x);
  w.f32(body.position.z);
  w.f32(body.radius);
  w.u32(body.seed);
  if (kind === BODY_KIND.prey) {
    w.u8(packUnit(body.appear));
  } else if (kind === BODY_KIND.comet) {
    w.f32(body.velocity.x);
    w.f32(body.velocity.z);
    w.u8(packUnit(body.fade ?? 1));
  } else if (kind === BODY_KIND.debris) {
    w.f32(body.velocity.x);
    w.f32(body.velocity.z);
    w.f32(body.age ?? 0);
    w.f32(body.mass);
    w.varint((body.ownerId ?? -1) + 1);
  } else {
    w.u8(body.layer ?? 0);
  }
  if (eating) {
    w.varint(body.eaterId + 1);
    w.u16(Math.round(Math.min(1, Math.max(0, body.eatProgress)) * 65535));
    w.f32(body.eatOffset.x);
    w.f32(body.eatOffset.z);
    w.u8(packUnit(body.infallWeight));
    w.f32(body.infallTime);
  }
}

/** The client should forget this pooled body (gone, or out of its area). */
export function writeBodyRemoved(w: Writer, kind: BodyKind, slot: number): void {
  w.u8(kind | (REMOVED << 2));
  w.varint(slot);
}

export function writeRect(w: Writer, layer: number, c0: number, r0: number, c1: number, r1: number): void {
  w.u8(layer);
  w.u16(c0);
  w.u16(r0);
  w.u16(c1);
  w.u16(r1);
}

/**
 * A group of one layer's cell records: cells[from..to) (sorted ascending, at most 0xffff of them) as they are in the
 * layer's `taken` and `epoch` arrays.
 */
export function writeCells(
  w: Writer,
  layer: number,
  cells: ArrayLike<number>,
  from: number,
  to: number,
  taken: ArrayLike<number>,
  epoch: ArrayLike<number>,
): void {
  w.u8(layer);
  w.u16(to - from);
  let prev = 0;
  for (let i = from; i < to; i++) {
    const cell = cells[i];
    w.varint(cell - prev);
    prev = cell;
    const t = taken[cell];
    w.varint(epoch[cell] * 2 + (t !== 0 ? 1 : 0));
    if (t !== 0) w.u16(t);
  }
}

export function writeEvent(w: Writer, e: SimEvent): void {
  switch (e.type) {
    case 'ate': {
      const what = e.what;
      const index = what && !what.hole ? MEAL_NAMES.indexOf(what.name) : -1;
      w.u8(EV.ate);
      w.varint(e.hole);
      w.f32(e.mass);
      w.f32(e.gained);
      w.f32(e.holeMass);
      w.f32(e.holeRadius);
      w.u8((e.reclaimed ? 1 : 0) | (e.biggest ? 2 : 0) | (what ? 4 : 0) | (what?.hole ? 8 : 0) | (what && index < 0 ? 16 : 0));
      if (what) {
        w.f32(what.radius);
        if (index < 0) w.string(what.name);
        else w.u8(index);
      }
      break;
    }
    case 'bumped':
      w.u8(EV.bumped);
      w.varint(e.hole);
      w.f32(e.x);
      w.f32(e.z);
      w.f32(e.radius);
      w.i8(Math.round(e.nx * 127));
      w.i8(Math.round(e.nz * 127));
      w.u8(BUMP_BY.indexOf(e.by));
      break;
    case 'shed':
      w.u8(EV.shed);
      w.varint(e.hole);
      w.f32(e.mass);
      break;
    case 'milestone':
      w.u8(EV.milestone);
      w.varint(e.hole);
      w.u8(e.index);
      break;
    case 'holeEaten':
      w.u8(EV.holeEaten);
      w.varint(e.eater);
      w.varint(e.victim);
      w.string(e.eaterName);
      w.string(e.victimName);
      w.f32(e.x);
      w.f32(e.z);
      w.f32(e.eaterRadius);
      w.f32(e.victimRadius);
      w.f32(e.gained);
      break;
    case 'died':
      w.u8(EV.died);
      w.varint(e.hole);
      w.u8(e.cause === 'eaten' ? 1 : 0);
      w.varint(e.by + 1);
      w.string(e.byName);
      break;
  }
}

/** Decode a snapshot frame. Throws on a malformed one. */
export function readSnapshot(bytes: Uint8Array): Snapshot {
  const r = new Reader(bytes);
  if (r.u8() !== BINARY.snapshot) throw new RangeError('not a snapshot');
  const tick = r.u32();
  const ack = r.u32();
  const unit = unpackLog(r.u16());
  const sections = r.u8();
  const you = readYou(r);
  const holes: NetHole[] = [];
  for (let n = r.u16(); n > 0; n--) holes.push(readHole(r, you.x, you.z, unit));
  const gone: number[] = [];
  if (sections & SECTION.gone) for (let n = r.u16(); n > 0; n--) gone.push(r.varint());
  const bodies: NetBody[] = [];
  if (sections & SECTION.bodies) for (let n = r.u16(); n > 0; n--) bodies.push(readBody(r));
  const rects: NetRect[] = [];
  if (sections & SECTION.rects) {
    for (let n = r.u8(); n > 0; n--) rects.push({ layer: r.u8(), c0: r.u16(), r0: r.u16(), c1: r.u16(), r1: r.u16() });
  }
  const cells: NetCell[] = [];
  if (sections & SECTION.cells) {
    for (let layers = r.u8(); layers > 0; layers--) {
      const layer = r.u8();
      let cell = 0;
      for (let n = r.u16(); n > 0; n--) {
        cell += r.varint();
        const e = r.varint();
        const taken = e & 1 ? r.u16() : 0;
        cells.push({ layer, cell, taken, epoch: Math.floor(e / 2) });
      }
    }
  }
  const events: SimEvent[] = [];
  if (sections & SECTION.events) for (let n = r.u16(); n > 0; n--) events.push(readEvent(r));
  if (r.remaining !== 0) throw new RangeError('trailing bytes');
  return { tick, ack, unit, you, holes, gone, bodies, rects, cells, events };
}

function readYou(r: Reader): NetYou {
  const gen = r.varint();
  const flags = r.u8();
  const you: NetYou = {
    gen,
    phase: PHASES[flags & 3],
    x: r.f32(),
    z: r.f32(),
    vx: r.f32(),
    vz: r.f32(),
    pullX: r.f32(),
    pullZ: r.f32(),
    radius: r.f32(),
    mass: r.f32(),
    eatenMass: unpackLog(r.u16()),
    hunger: unpackUnit(r.u8()),
    stun: unpackSteps(r.u8(), STEP),
    invulnerable: unpackSteps(r.u8(), STEP),
    protection: unpackSteps(r.u8(), STEP),
    shrink: unpackSteps(r.u8(), STEP),
    eatenBy: -1,
    eatProgress: 0,
    eatOffsetX: 0,
    eatOffsetZ: 0,
  };
  if (flags & HOLE_EATEN) readEaten(r, you);
  return you;
}

function readEaten(r: Reader, into: NetYou | NetHole): void {
  into.eatenBy = r.varint() - 1;
  into.eatProgress = unpackUnit(r.u8());
  into.eatOffsetX = r.f32();
  into.eatOffsetZ = r.f32();
}

function readHole(r: Reader, cx: number, cz: number, unit: number): NetHole {
  const id = r.varint();
  const flags = r.u8();
  let gen: number | null = null;
  let name: string | null = null;
  if (flags & HOLE_INTRO) {
    gen = r.varint();
    name = r.string();
  }
  let x: number;
  let z: number;
  if (flags & HOLE_WIDE) {
    x = r.f32();
    z = r.f32();
  } else {
    x = cx + r.i16() * unit;
    z = cz + r.i16() * unit;
  }
  const hole: NetHole = {
    id,
    gen,
    name,
    x,
    z,
    radius: unpackLog(r.u16()),
    mass: unpackLog(r.u16()),
    eatenMass: unpackLog(r.u16()),
    phase: PHASES[flags & 3],
    hunger: unpackUnit(r.u8()),
    invulnerable: 0,
    protection: 0,
    eatenBy: -1,
    eatProgress: 0,
    eatOffsetX: 0,
    eatOffsetZ: 0,
  };
  if (flags & HOLE_TIMERS) {
    hole.invulnerable = unpackTimer(r.u8());
    hole.protection = unpackTimer(r.u8());
  }
  if (flags & HOLE_EATEN) readEaten(r, hole);
  return hole;
}

function readBody(r: Reader): NetBody {
  const head = r.u8();
  const kind = (head & 3) as BodyKind;
  const state = head >> 2;
  const body: NetBody = {
    kind,
    slot: r.varint(),
    state: state === ALIVE ? 'alive' : state === EATING ? 'eating' : null,
    gen: 0,
    x: 0,
    z: 0,
    radius: 0,
    seed: 0,
    appear: 1,
    vx: 0,
    vz: 0,
    fade: 1,
    age: 0,
    mass: 0,
    ownerId: -1,
    layer: 0,
    eaterId: -1,
    eatProgress: 0,
    eatOffsetX: 0,
    eatOffsetZ: 0,
    infallWeight: 0,
    infallTime: 1,
  };
  if (state === REMOVED) return body;
  if (state !== ALIVE && state !== EATING) throw new RangeError('bad body state');
  body.gen = r.varint();
  body.x = r.f32();
  body.z = r.f32();
  body.radius = r.f32();
  body.seed = r.u32();
  if (kind === BODY_KIND.prey) {
    body.appear = unpackUnit(r.u8());
  } else if (kind === BODY_KIND.comet) {
    body.vx = r.f32();
    body.vz = r.f32();
    body.fade = unpackUnit(r.u8());
  } else if (kind === BODY_KIND.debris) {
    body.vx = r.f32();
    body.vz = r.f32();
    body.age = r.f32();
    body.mass = r.f32();
    body.ownerId = r.varint() - 1;
  } else {
    body.layer = r.u8();
  }
  if (state === EATING) {
    body.eaterId = r.varint() - 1;
    body.eatProgress = r.u16() / 65535;
    body.eatOffsetX = r.f32();
    body.eatOffsetZ = r.f32();
    body.infallWeight = unpackUnit(r.u8());
    body.infallTime = r.f32();
  }
  return body;
}

function readEvent(r: Reader): SimEvent {
  const type = r.u8();
  switch (type) {
    case EV.ate: {
      const hole = r.varint();
      const mass = r.f32();
      const gained = r.f32();
      const holeMass = r.f32();
      const holeRadius = r.f32();
      const flags = r.u8();
      let what: Meal | null = null;
      if (flags & 4) {
        const radius = r.f32();
        const name = flags & 16 ? r.string() : MEAL_NAMES[r.u8()];
        if (name === undefined) throw new RangeError('bad meal');
        what = flags & 8 ? { name, radius, hole: true } : { name, radius };
      }
      return { type: 'ate', hole, mass, gained, holeMass, holeRadius, what, reclaimed: (flags & 1) !== 0, biggest: (flags & 2) !== 0 };
    }
    case EV.bumped: {
      const hole = r.varint();
      const x = r.f32();
      const z = r.f32();
      const radius = r.f32();
      const nx = r.i8() / 127;
      const nz = r.i8() / 127;
      const by = BUMP_BY[r.u8()];
      if (by === undefined) throw new RangeError('bad bump');
      return { type: 'bumped', hole, x, z, radius, nx, nz, by };
    }
    case EV.shed:
      return { type: 'shed', hole: r.varint(), mass: r.f32() };
    case EV.milestone:
      return { type: 'milestone', hole: r.varint(), index: r.u8() };
    case EV.holeEaten:
      return {
        type: 'holeEaten',
        eater: r.varint(),
        victim: r.varint(),
        eaterName: r.string(),
        victimName: r.string(),
        x: r.f32(),
        z: r.f32(),
        eaterRadius: r.f32(),
        victimRadius: r.f32(),
        gained: r.f32(),
      };
    case EV.died: {
      const hole = r.varint();
      const cause = r.u8() === 1 ? 'eaten' : 'evaporated';
      return { type: 'died', hole, cause, by: r.varint() - 1, byName: r.string() };
    }
    default:
      throw new RangeError(`bad event ${type}`);
  }
}
