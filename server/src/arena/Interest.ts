import { COMETS, NET } from '../../../src/config/index.ts';
import {
  BODY_KIND,
  SECTION,
  snapshotUnit,
  writeBody,
  writeBodyRemoved,
  writeCells,
  writeEvent,
  writeHeader,
  writeHole,
  writeRect,
  writeYou,
  youCentre,
  type BodyExtras,
  type BodyKind,
} from '../../../src/protocol/snapshot.ts';
import type { Writer } from '../../../src/protocol/wire.ts';
import type { Body } from '../../../src/sim/body.ts';
import type { SimEvent } from '../../../src/sim/events.ts';
import { viewDistance, type Hole } from '../../../src/sim/Hole.ts';
import { CELL_STRIDE } from '../../../src/sim/MatterField.ts';
import type { World } from '../../../src/sim/World.ts';

const ALIVE = 1;
const EATING = 2;

/** What one client was last told about each slot of a body pool. */
class Sent {
  /** Body gen as sent, or -1: the client does not have it. */
  readonly gen: Int32Array;
  readonly state: Uint8Array;
  /** Where it was sent (prey only: they sit still unless pushed apart). */
  readonly x: Float32Array;
  readonly z: Float32Array;

  constructor(size: number) {
    this.gen = new Int32Array(size).fill(-1);
    this.state = new Uint8Array(size);
    this.x = new Float32Array(size);
    this.z = new Float32Array(size);
  }
}

type Pooled = Body & BodyExtras & { active?: boolean };

/**
 * Interest management for one client: what lies near its hole and what it has already been told. Each snapshot it
 * writes the client's own hole, every hole near it, the bodies, comets, debris and falling grains that came near or
 * changed (and the ones to forget), the field cells around it that differ from what it knows, and the events it
 * should see (see src/protocol/snapshot.ts for the format). "Near" is the interest radius: the client's screen reach
 * plus a margin, in view distances of its hole; things are forgotten a little further out (NET.interest.leaveFactor).
 */
export class Interest {
  /** Screen reach in view distances (see NET.interest), as the client said. */
  reach: number = NET.interest.reachMax;
  /** Interest radius and centre of the last snapshot written (world units). */
  radius = 0;
  cx = 0;
  cz = 0;
  /** Hole id to the life (gen) it was introduced with. */
  private readonly holes = new Map<number, number>();
  private readonly seen = new Set<number>();
  private readonly goneNow: number[] = [];
  private readonly prey: Sent;
  private readonly comets: Sent;
  private readonly debris: Sent;
  private readonly infall: Sent;
  /** Per field layer: the synced rectangle (c0, r0, c1, r1; c1 < c0 when not synced) and whether it is synced. */
  private readonly rects: Int32Array;
  private readonly synced: Uint8Array;
  /** Rectangles to send whatever happens (the first snapshot, or after a missed one). */
  private resend = true;
  /** The rectangles as of the last snapshot, while this one moves them. */
  private readonly prev: Int32Array;
  private readonly cells: number[][];
  private readonly rectChanged: Uint8Array;

  constructor(world: World) {
    this.prey = new Sent(world.prey.objects.length);
    this.comets = new Sent(world.comets.objects.length);
    this.debris = new Sent(world.debris.objects.length);
    this.infall = new Sent(world.field.infall.length);
    const layers = world.field.layers.length;
    this.rects = new Int32Array(layers * 4);
    for (let i = 0; i < layers; i++) this.rects[i * 4 + 2] = this.rects[i * 4 + 3] = -1;
    this.prev = new Int32Array(layers * 4);
    this.synced = new Uint8Array(layers);
    this.cells = world.field.layers.map(() => []);
    this.rectChanged = new Uint8Array(layers);
  }

  /** The client did not get a snapshot: the field changes in it are lost, so the next one sends its whole field area again. */
  missed(): void {
    for (let i = 0; i < this.synced.length; i++) {
      this.rects[i * 4] = 0;
      this.rects[i * 4 + 1] = 0;
      this.rects[i * 4 + 2] = -1;
      this.rects[i * 4 + 3] = -1;
    }
    this.resend = true;
  }

  /**
   * Write a snapshot for the client of `hole` into `w`. `events` are the world's since the last snapshot; the field
   * cells that changed since then are in world.field.changes (the room clears both once every client is done).
   */
  write(w: Writer, world: World, hole: Hole, ack: number, events: readonly SimEvent[]): void {
    const I = NET.interest;
    const { x: cx, z: cz } = youCentre(hole);
    const view = viewDistance(hole.radius);
    const enter = (this.reach + I.margin) * view;
    const leave = enter * I.leaveFactor;
    const unit = snapshotUnit(enter / 8192);
    this.radius = enter;
    this.cx = cx;
    this.cz = cz;
    let sections = 0;
    const sectionsAt = writeHeader(w, world.tick, ack, unit);
    writeYou(w, hole);

    // Other holes while near, every time (they move).
    const countAt = w.reserveU16();
    let n = 0;
    this.seen.clear();
    for (const other of world.holes) {
      if (other === hole || other.phase === 'over') continue;
      const same = this.holes.get(other.id) === other.gen;
      const reach = (same ? leave : enter) + I.holeMargin * other.radius;
      const dx = other.position.x - cx;
      const dz = other.position.z - cz;
      if (dx * dx + dz * dz > reach * reach) continue;
      writeHole(w, other, !same, cx, cz, unit);
      this.holes.set(other.id, other.gen);
      this.seen.add(other.id);
      n++;
    }
    w.patchU16(countAt, n);
    this.goneNow.length = 0;
    for (const id of this.holes.keys()) if (!this.seen.has(id)) this.goneNow.push(id);
    if (this.goneNow.length > 0) {
      sections |= SECTION.gone;
      w.u16(this.goneNow.length);
      for (const id of this.goneNow) {
        w.varint(id);
        this.holes.delete(id);
      }
    }

    // Bodies: only what came near, changed or should be forgotten.
    const bodiesAt = w.reserveU16();
    let b = 0;
    b += this.pool(w, BODY_KIND.prey, world.prey.objects, this.prey, cx, cz, enter, leave, 0);
    b += this.pool(w, BODY_KIND.comet, world.comets.objects, this.comets, cx, cz, enter, leave, COMETS.tailLengthView * view);
    b += this.pool(w, BODY_KIND.debris, world.debris.objects, this.debris, cx, cz, enter, leave, 0);
    b += this.pool(w, BODY_KIND.infall, world.field.infall, this.infall, cx, cz, enter, leave, 0);
    if (b > 0) {
      sections |= SECTION.bodies;
      w.patchU16(bodiesAt, b);
    } else {
      w.length = bodiesAt;
    }

    sections |= this.field(w, world, cx, cz, view, enter);

    // Events: your own, and what happens near you; every hole eaten anywhere (the kill feed).
    const eventsAt = w.reserveU16();
    let e = 0;
    const leaveSq = leave * leave;
    for (const ev of events) {
      switch (ev.type) {
        case 'ate':
        case 'milestone':
          if (ev.hole !== hole.id) continue;
          break;
        case 'bumped':
          if (ev.hole !== hole.id && (ev.x - cx) ** 2 + (ev.z - cz) ** 2 > leaveSq) continue;
          break;
        case 'shed':
        case 'died':
          if (ev.hole !== hole.id && !this.holes.has(ev.hole) && !this.goneNow.includes(ev.hole)) continue;
          break;
        case 'holeEaten':
          break;
      }
      writeEvent(w, ev);
      e++;
    }
    if (e > 0) {
      sections |= SECTION.events;
      w.patchU16(eventsAt, e);
    } else {
      w.length = eventsAt;
    }
    w.patchU8(sectionsAt, sections);
  }

  /**
   * One body pool: a record for each slot that came within reach or changed, a removal for each the client has that is
   * gone or out of reach. Returns the number of records. `pad` widens the reach (a comet's tail).
   */
  private pool(w: Writer, kind: BodyKind, objects: readonly Pooled[], sent: Sent, cx: number, cz: number, enter: number, leave: number, pad: number): number {
    const margin = kind === BODY_KIND.comet ? NET.interest.cometMargin : 1;
    let n = 0;
    for (let slot = 0; slot < objects.length; slot++) {
      const body = objects[slot];
      const live = kind === BODY_KIND.prey ? body.state !== 'gone' : body.active === true;
      const known = sent.gen[slot] >= 0;
      let near = false;
      if (live) {
        const reach = (known && sent.gen[slot] === body.gen ? leave : enter) + body.radius * margin + pad;
        const dx = body.position.x - cx;
        const dz = body.position.z - cz;
        near = dx * dx + dz * dz <= reach * reach;
      }
      if (!near) {
        if (known) {
          writeBodyRemoved(w, kind, slot);
          sent.gen[slot] = -1;
          n++;
        }
        continue;
      }
      const state = body.state === 'eating' ? EATING : ALIVE;
      if (known && sent.gen[slot] === body.gen && sent.state[slot] === state) {
        if (kind !== BODY_KIND.prey) continue;
        const moved = Math.abs(body.position.x - sent.x[slot]) + Math.abs(body.position.z - sent.z[slot]);
        if (moved <= body.radius * 1e-3) continue;
      }
      writeBody(w, kind, slot, body);
      sent.gen[slot] = body.gen;
      sent.state[slot] = state;
      sent.x[slot] = body.position.x;
      sent.z[slot] = body.position.z;
      n++;
    }
    return n;
  }

  /**
   * The procedural field: per layer whose grains are big enough to see at this view distance, a rectangle of cells
   * around the centre (moved only when the area pokes out of it, or it has grown far too big). Cells entering the
   * rectangle are sent if they differ from the seed's layout; cells inside that changed are sent as they are now.
   * Returns the sections written.
   */
  private field(w: Writer, world: World, cx: number, cz: number, view: number, enter: number): number {
    const I = NET.interest;
    const field = world.field;
    const layers = field.layers;
    const rects = this.rects;
    const prev = this.prev;
    prev.set(rects);
    let rectCount = 0;
    for (let L = 0; L < layers.length; L++) {
      const layer = layers[L];
      const k = L * 4;
      const ratio = layer.def.radius[1] / view;
      const want = field.enabled && ratio >= I.fieldMinSize * (this.synced[L] ? I.layerHysteresis : 1);
      this.synced[L] = want ? 1 : 0;
      const oc0 = prev[k];
      const or0 = prev[k + 1];
      const oc1 = prev[k + 2];
      const or1 = prev[k + 3];
      let nc0 = 0;
      let nr0 = 0;
      let nc1 = -1;
      let nr1 = -1;
      if (want) {
        const far = enter * I.leaveFactor;
        // Keep the rectangle while it holds the area and is not much bigger than it.
        const keep =
          oc1 >= oc0 &&
          oc0 <= layer.col(cx - enter) &&
          or0 <= layer.col(cz - enter) &&
          oc1 >= layer.col(cx + enter) &&
          or1 >= layer.col(cz + enter) &&
          oc0 >= layer.col(cx - far) &&
          or0 >= layer.col(cz - far) &&
          oc1 <= layer.col(cx + far) &&
          or1 <= layer.col(cz + far);
        if (keep) {
          nc0 = oc0;
          nr0 = or0;
          nc1 = oc1;
          nr1 = or1;
        } else {
          const pad = (enter + far) / 2;
          nc0 = layer.col(cx - pad);
          nr0 = layer.col(cz - pad);
          nc1 = layer.col(cx + pad);
          nr1 = layer.col(cz + pad);
        }
      }
      const changed = nc0 !== oc0 || nr0 !== or0 || nc1 !== oc1 || nr1 !== or1;
      this.rectChanged[L] = changed || this.resend ? 1 : 0;
      if (this.rectChanged[L]) rectCount++;
      rects[k] = nc0;
      rects[k + 1] = nr0;
      rects[k + 2] = nc1;
      rects[k + 3] = nr1;
      // Cells that entered the rectangle and are not as the seed laid them out.
      const list = this.cells[L];
      list.length = 0;
      if (!changed || nc1 < nc0) continue;
      const hadOld = oc1 >= oc0;
      for (let row = nr0; row <= nr1; row++) {
        const oldRow = hadOld && row >= or0 && row <= or1;
        for (let col = nc0; col <= nc1; col++) {
          if (oldRow && col >= oc0 && col <= oc1) {
            col = oc1;
            continue;
          }
          const cell = row * layer.cols + col;
          if (layer.dirty(cell)) list.push(cell);
        }
      }
    }

    // Cells that changed inside the rectangle, that it held before too (cells that just entered were sent whole above).
    for (const key of field.changes) {
      const L = Math.floor(key / CELL_STRIDE);
      const cell = key - L * CELL_STRIDE;
      const k = L * 4;
      const cols = layers[L].cols;
      const col = cell % cols;
      const row = Math.floor(cell / cols);
      if (col < rects[k] || col > rects[k + 2] || row < rects[k + 1] || row > rects[k + 3]) continue;
      if (col < prev[k] || col > prev[k + 2] || row < prev[k + 1] || row > prev[k + 3]) continue;
      this.cells[L].push(cell);
    }

    let sections = 0;
    if (rectCount > 0) {
      sections |= SECTION.rects;
      w.u8(rectCount);
      for (let L = 0; L < layers.length; L++) {
        if (!this.rectChanged[L]) continue;
        const k = L * 4;
        // An empty rectangle goes out as c1 < c0 (u16, so 1 and 0).
        if (rects[k + 2] < rects[k]) writeRect(w, L, 1, 1, 0, 0);
        else writeRect(w, L, rects[k], rects[k + 1], rects[k + 2], rects[k + 3]);
      }
    }
    // Cell records in groups of one layer each (at most 0xffff cells a group).
    let groups = 0;
    for (const list of this.cells) groups += Math.ceil(list.length / 0xffff);
    if (groups > 0) {
      sections |= SECTION.cells;
      w.u8(groups);
      for (let L = 0; L < layers.length; L++) {
        const list = this.cells[L];
        if (list.length === 0) continue;
        list.sort((a, b) => a - b);
        const layer = layers[L];
        for (let from = 0; from < list.length; from += 0xffff) {
          writeCells(w, L, list, from, Math.min(list.length, from + 0xffff), layer.taken, layer.epoch);
        }
      }
    }
    this.resend = false;
    return sections;
  }
}
