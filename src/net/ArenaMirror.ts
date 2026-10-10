import { COMETS, DEBRIS, FIELD, PREY } from '../config/index.ts';
import { BODY_KIND, type NetBody, type NetHole, type NetRect, type Snapshot } from '../protocol/snapshot.ts';
import { capture, type Body } from '../sim/body.ts';
import type { SimEvent } from '../sim/events.ts';
import { Hole, massOfRadius } from '../sim/Hole.ts';
import type { RunPhase } from '../sim/Hunger.ts';
import { lerp } from '../sim/math.ts';
import type { Vec2 } from '../sim/vec.ts';
import { World } from '../sim/World.ts';

/** What of the procedural field a client may draw: online, only the layers and cells it is kept in sync with. */
export interface FieldSight {
  layerShown(layer: number): boolean;
  cellShown(layer: number, cell: number): boolean;
}

/** Most snapshots of one hole kept for drawing it in the past (0.8 s at 20 a second). */
const MAX_SAMPLES = 16;
/** Another hole's event this many ticks older than the drawing time is dropped instead of shown (a second at 60). */
const STALE_EVENT_TICKS = 60;

/** Another hole as the client follows it: its Hole in the mirror world and its recent snapshot records. */
class Track {
  readonly hole: Hole;
  /** Records in tick order (the NetHole objects the snapshots decoded, kept as they are). */
  readonly ticks: number[] = [];
  readonly recs: NetHole[] = [];
  /** Tick of the snapshot that said the hole left the client's area (-1: it has not); it is dropped once drawn past it. */
  goneAt = -1;
  /** The phase as last drawn, to notice the moment it starts falling into its eater. */
  drawnPhase: RunPhase = 'playing';

  constructor(hole: Hole) {
    this.hole = hole;
  }

  push(tick: number, rec: NetHole): void {
    if (this.ticks.length > 0 && tick <= this.ticks[this.ticks.length - 1]) return;
    this.ticks.push(tick);
    this.recs.push(rec);
    if (this.ticks.length > MAX_SAMPLES) {
      this.ticks.shift();
      this.recs.shift();
    }
  }

  clear(): void {
    this.ticks.length = 0;
    this.recs.length = 0;
    this.drawnPhase = 'playing';
  }
}

/**
 * The arena as an online client knows it: a src/sim World built from the room's seed and filled in from the server's
 * snapshots (src/protocol/snapshot.ts), never stepped as a whole. The renderers read it like the offline world.
 *
 * - Holes: the own hole (`local`, set by Prediction) and every other hole near it. Other holes are drawn a little in the
 *   past (`interpolate`): between the two snapshot records around the drawing time, so they move smoothly however
 *   the snapshots arrive. One that leaves is dropped once drawn past the moment it left.
 * - Pooled bodies (arena bodies, comets, debris, falling grains) keep the server's slots: a record sets a slot, a
 *   removal empties it, and in between `advance` moves them by the same rules (comets fly straight, debris slows, a
 *   fall runs on its clock).
 * - The procedural field: per layer the synced rectangle of cells; cells entering it start as the seed laid them out,
 *   then the cell records apply. Only synced layers and cells are drawn (`sight`): elsewhere the client does not know.
 * - Events: the own hole's at once, the rest when the drawing time reaches their snapshot (in step with the holes).
 *
 * A body falling into a hole (and a hole falling into another) is drawn from where it was seen toward its eater as
 * drawn on this client: the offset from the eater is taken when the fall is first seen, so nothing jumps between the
 * predicted own hole, the holes drawn in the past and the server's moment.
 */
export class ArenaMirror {
  readonly world: World;
  /** The own hole: in world.holes, its state set by Prediction from each snapshot's `you`. */
  readonly local: Hole;
  /** Per field layer: the synced rectangle (c0, r0, c1, r1; c1 < c0 when not synced). */
  readonly rects: Int32Array;
  readonly sight: FieldSight;
  /** Where the own hole is drawn (the prediction plus its fading correction); set by the owner each frame. */
  readonly ownDrawn: Vec2 = { x: 0, z: 0 };
  private readonly tracks = new Map<number, Track>();
  private readonly pending: { tick: number; event: SimEvent }[] = [];
  private bodiesMoved = false;

  constructor(seed: number, hole: number, name: string) {
    this.world = new World({ seed, local: false });
    const world = this.world;
    // As the seed lays it out (the world's own bodies covered some grains); a client knows only what it is told.
    world.field.reset();
    for (const body of world.prey.objects) body.state = 'gone';
    world.prey.rebuild();
    this.local = new Hole(hole);
    this.local.name = name;
    world.holes.push(this.local);
    const layers = world.field.layers.length;
    this.rects = new Int32Array(layers * 4);
    for (let i = 0; i < layers; i++) {
      this.rects[i * 4 + 2] = -1;
      this.rects[i * 4 + 3] = -1;
    }
    const rects = this.rects;
    const field = world.field;
    this.sight = {
      layerShown: (layer) => rects[layer * 4 + 2] >= rects[layer * 4],
      cellShown: (layer, cell) => {
        const k = layer * 4;
        const cols = field.layers[layer].cols;
        const col = cell % cols;
        const row = (cell - col) / cols;
        return col >= rects[k] && col <= rects[k + 2] && row >= rects[k + 1] && row <= rects[k + 3];
      },
    };
  }

  /** Other holes followed right now (tests). */
  get tracked(): number {
    return this.tracks.size;
  }

  /**
   * Take in a snapshot (in the order they came). Its own-hole part (`you`) is Prediction's. `effects` false drops
   * its events (a backlog the player never saw).
   */
  apply(s: Snapshot, effects = true): void {
    for (const h of s.holes) this.applyHole(s.tick, h);
    for (const id of s.gone) {
      const track = this.tracks.get(id);
      if (track && track.goneAt < 0) track.goneAt = s.tick;
    }
    for (const b of s.bodies) this.applyBody(b);
    if (this.bodiesMoved) {
      this.world.prey.rebuild();
      this.bodiesMoved = false;
    }
    for (const r of s.rects) this.applyRect(r);
    const field = this.world.field;
    for (const c of s.cells) {
      const layer = field.layers[c.layer];
      if (layer && c.cell < layer.cols * layer.cols) field.setCell(c.layer, c.cell, c.taken, c.epoch);
    }
    if (!effects) return;
    for (const e of s.events) {
      if (this.isOwn(e)) this.release(e);
      else this.pending.push({ tick: s.tick, event: e });
    }
  }

  /** One local step for everything the server only tells about when it changes. */
  advance(dt: number): void {
    const world = this.world;
    world.time += dt;
    for (const obj of world.prey.objects) {
      capture(obj);
      if (obj.state === 'eating') {
        obj.eatProgress += dt / obj.infallTime;
        if (obj.eatProgress >= 1) obj.state = 'gone';
      } else if (obj.state === 'alive' && obj.appear < 1) {
        obj.appear = Math.min(1, obj.appear + dt / PREY.appearTime);
      }
    }
    for (const comet of world.comets.objects) {
      if (!comet.active) continue;
      capture(comet);
      if (comet.state === 'eating') {
        comet.eatProgress += dt / comet.infallTime;
        comet.fade = Math.max(0, 1 - comet.eatProgress * 2);
        if (comet.eatProgress >= 1) comet.active = false;
        continue;
      }
      comet.position.x += comet.velocity.x * dt;
      comet.position.z += comet.velocity.z * dt;
      comet.fade = Math.min(1, comet.fade + dt / COMETS.appearTime);
    }
    const drag = Math.exp(-DEBRIS.drag * dt);
    for (const frag of world.debris.objects) {
      if (!frag.active) continue;
      capture(frag);
      frag.age += dt;
      if (frag.state === 'eating') {
        frag.eatProgress += dt / frag.infallTime;
        if (frag.eatProgress >= 1) frag.active = false;
        continue;
      }
      frag.position.x += frag.velocity.x * dt;
      frag.position.z += frag.velocity.z * dt;
      frag.velocity.x *= drag;
      frag.velocity.z *= drag;
      this.debrisLook(frag);
      if (frag.age >= DEBRIS.lifetime) frag.active = false;
    }
    for (const body of world.field.infall) {
      if (!body.active) continue;
      capture(body);
      body.eatProgress += dt / body.infallTime;
      if (body.eatProgress >= 1) body.active = false;
    }
  }

  /**
   * Draw the other holes as of `tick` (fractional server ticks, in the past): between the records around it, carried
   * on along their last motion for at most `extrapolate` ticks past the newest. Releases the events that time has
   * reached and drops the holes that have left.
   */
  interpolate(tick: number, extrapolate: number): void {
    const world = this.world;
    for (const [id, track] of this.tracks) {
      if (track.goneAt >= 0 && tick >= track.goneAt) {
        this.drop(id, track);
        continue;
      }
      this.draw(track, tick, extrapolate);
    }
    if (this.pending.length > 0) {
      let n = 0;
      for (; n < this.pending.length && this.pending[n].tick <= tick; n++) {
        // Long past (frames stopped for a while): dropped, not played all at once.
        if (this.pending[n].tick >= tick - STALE_EVENT_TICKS) this.release(this.pending[n].event);
      }
      if (n > 0) this.pending.splice(0, n);
    }
    // Something told about in a snapshot but not yet drawn waits; a backlog (a hidden tab) does not grow forever.
    if (world.events.length > 400) world.events.splice(0, world.events.length - 400);
  }

  /** An event goes to the world's queue (the game drains it); the own hole's life is counted on the way. */
  private release(e: SimEvent): void {
    const local = this.local;
    switch (e.type) {
      case 'ate':
        if (e.hole === local.id) {
          local.eatenCount++;
          if (e.biggest && e.what) local.biggestEaten = e.what;
        }
        break;
      case 'milestone':
        if (e.hole === local.id) local.milestone = Math.max(local.milestone, e.index);
        break;
      case 'holeEaten':
        if (e.eater === local.id) local.holesEaten++;
        if (e.victim === local.id) local.eatenByName = e.eaterName;
        break;
      case 'died':
        if (e.hole === local.id && e.cause === 'eaten') local.eatenByName = e.byName;
        break;
    }
    this.world.events.push(e);
  }

  private isOwn(e: SimEvent): boolean {
    const id = this.local.id;
    switch (e.type) {
      case 'holeEaten':
        return e.eater === id || e.victim === id;
      default:
        return e.hole === id;
    }
  }

  private applyHole(tick: number, h: NetHole): void {
    if (h.id === this.local.id) return;
    let track = this.tracks.get(h.id);
    if (h.gen !== null) {
      // An introduction: a hole new to this client, back in its area, or on a new life.
      if (!track) {
        const hole = new Hole(h.id);
        this.world.holes.push(hole);
        track = new Track(hole);
        this.tracks.set(h.id, track);
      }
      track.clear();
      track.hole.gen = h.gen;
      track.hole.name = h.name ?? '';
      track.hole.eatenBy = -1;
    } else if (!track) {
      // Never introduced: nothing to draw it with.
      return;
    }
    track.goneAt = -1;
    track.push(tick, h);
  }

  private drop(id: number, track: Track): void {
    const holes = this.world.holes;
    const i = holes.indexOf(track.hole);
    if (i >= 0) holes.splice(i, 1);
    this.tracks.delete(id);
  }

  private draw(track: Track, tick: number, extrapolate: number): void {
    const { ticks, recs, hole } = track;
    const n = ticks.length;
    if (n === 0) return;
    let i = n - 1;
    while (i > 0 && ticks[i] > tick) i--;
    const a = recs[i];
    let x = a.x;
    let z = a.z;
    let radius = a.radius;
    let progress = a.eatProgress;
    if (tick > ticks[i]) {
      if (i + 1 < n) {
        const b = recs[i + 1];
        const f = (tick - ticks[i]) / (ticks[i + 1] - ticks[i]);
        x = lerp(a.x, b.x, f);
        z = lerp(a.z, b.z, f);
        radius = lerp(a.radius, b.radius, f);
        if (b.phase === 'eaten' && a.phase === 'eaten') progress = lerp(a.eatProgress, b.eatProgress, f);
      } else if (i > 0 && a.phase === 'playing') {
        // Past the newest record: carry on a little along the last motion.
        const p = recs[i - 1];
        const k = Math.min(tick - ticks[i], extrapolate) / (ticks[i] - ticks[i - 1]);
        x += (a.x - p.x) * k;
        z += (a.z - p.z) * k;
      }
    }
    hole.position.x = hole.prevX = x;
    hole.position.z = hole.prevZ = z;
    hole.radius = hole.prevRadius = radius;
    hole.mass = a.mass;
    hole.eatenMass = a.eatenMass;
    hole.hunger.level = a.hunger;
    hole.invulnerable = a.invulnerable;
    hole.protection = a.protection;
    hole.hunger.phase = a.phase;
    if (a.phase === 'eaten') {
      if (track.drawnPhase !== 'eaten') {
        // The swallow, as drawn here: from where it is drawn now toward its eater as drawn now.
        hole.eatenBy = a.eatenBy;
        const eater = this.drawnAt(a.eatenBy);
        hole.eatOffset.x = eater ? x - eater.x : a.eatOffsetX;
        hole.eatOffset.z = eater ? z - eater.z : a.eatOffsetZ;
      }
      hole.eatProgress = hole.prevEat = progress;
    }
    track.drawnPhase = a.phase;
  }

  /** Where hole `id` is drawn right now (the own hole with its correction), or null if this client does not have it. */
  drawnAt(id: number): Vec2 | null {
    if (id === this.local.id) return this.ownDrawn;
    const track = this.tracks.get(id);
    return track ? track.hole.position : null;
  }

  private applyBody(b: NetBody): void {
    const world = this.world;
    switch (b.kind) {
      case BODY_KIND.prey: {
        const obj = world.prey.objects[b.slot];
        if (!obj) return;
        this.bodiesMoved = true;
        if (b.state === null) {
          obj.state = 'gone';
          return;
        }
        const falling = obj.state === 'eating' && obj.gen === b.gen;
        this.setBody(obj, b);
        obj.mass = massOfRadius(b.radius);
        obj.appear = b.appear;
        if (b.state === 'eating') this.setFall(obj, b, !falling);
        return;
      }
      case BODY_KIND.comet: {
        const comet = world.comets.objects[b.slot];
        if (!comet) return;
        if (b.state === null) {
          comet.active = false;
          return;
        }
        const falling = comet.active && comet.state === 'eating' && comet.gen === b.gen;
        comet.active = true;
        this.setBody(comet, b);
        comet.mass = massOfRadius(b.radius);
        comet.velocity.x = b.vx;
        comet.velocity.z = b.vz;
        comet.fade = b.fade;
        comet.appear = 1;
        if (b.state === 'eating') this.setFall(comet, b, !falling);
        return;
      }
      case BODY_KIND.debris: {
        const frag = world.debris.objects[b.slot];
        if (!frag) return;
        if (b.state === null) {
          frag.active = false;
          return;
        }
        const falling = frag.active && frag.state === 'eating' && frag.gen === b.gen;
        frag.active = true;
        this.setBody(frag, b);
        frag.velocity.x = b.vx;
        frag.velocity.z = b.vz;
        frag.age = b.age;
        frag.mass = b.mass;
        frag.ownerId = b.ownerId;
        this.debrisLook(frag);
        if (b.state === 'eating') this.setFall(frag, b, !falling);
        return;
      }
      case BODY_KIND.infall: {
        const body = world.field.infall[b.slot];
        const def = FIELD.layers[b.layer];
        if (!body) return;
        if (b.state === null || !def) {
          body.active = false;
          return;
        }
        const falling = body.active && body.gen === b.gen;
        body.active = true;
        body.layer = b.layer;
        body.className = def.name;
        body.round = def.round ?? false;
        body.color = def.color;
        this.setBody(body, b);
        body.mass = massOfRadius(b.radius);
        body.appear = 1;
        this.setFall(body, b, !falling);
        return;
      }
    }
  }

  /** The state every pooled body record carries; no interpolation from wherever the slot was drawn before. */
  private setBody(obj: Body, b: NetBody): void {
    obj.state = b.state ?? 'gone';
    obj.gen = b.gen;
    obj.seed = b.seed;
    obj.radius = b.radius;
    obj.position.x = b.x;
    obj.position.z = b.z;
    if (b.state !== 'eating') {
      obj.eaterId = -1;
      obj.eatProgress = 0;
    }
    capture(obj);
  }

  /** A body falling into a hole; a fall seen for the first time starts from where the body is, toward its eater as drawn here. */
  private setFall(obj: Body, b: NetBody, start: boolean): void {
    obj.eaterId = b.eaterId;
    obj.eatProgress = obj.prevEat = b.eatProgress;
    obj.infallWeight = b.infallWeight;
    obj.infallTime = b.infallTime;
    const eater = start ? this.drawnAt(b.eaterId) : null;
    if (eater) {
      obj.eatOffset.x = b.x - eater.x;
      obj.eatOffset.z = b.z - eater.z;
    } else if (start) {
      obj.eatOffset.x = b.eatOffsetX;
      obj.eatOffset.z = b.eatOffsetZ;
    }
  }

  /** Debris glow and fade-out follow from its age (as DebrisField works them out). */
  private debrisLook(frag: { age: number; heat: number; appear: number }): void {
    frag.heat = Math.exp(-DEBRIS.coolRate * frag.age);
    frag.appear = Math.min(1, Math.max(0, (DEBRIS.lifetime - frag.age) / DEBRIS.fadeTime));
  }

  /** A layer's rectangle moved: the cells that entered it start as the seed laid them out (the cell records follow). */
  private applyRect(r: NetRect): void {
    const field = this.world.field;
    const layer = field.layers[r.layer];
    if (!layer) return;
    const k = r.layer * 4;
    const rects = this.rects;
    const [oc0, or0, oc1, or1] = [rects[k], rects[k + 1], rects[k + 2], rects[k + 3]];
    const synced = r.c1 >= r.c0 && r.r1 >= r.r0;
    const last = layer.cols - 1;
    const c0 = Math.min(r.c0, last);
    const r0 = Math.min(r.r0, last);
    const c1 = Math.min(r.c1, last);
    const r1 = Math.min(r.r1, last);
    if (synced) {
      for (let row = r0; row <= r1; row++) {
        const kept = row >= or0 && row <= or1;
        for (let col = c0; col <= c1; col++) {
          if (kept && col >= oc0 && col <= oc1) continue;
          field.setCell(r.layer, row * layer.cols + col, 0, 0);
        }
      }
    }
    rects[k] = synced ? c0 : 0;
    rects[k + 1] = synced ? r0 : 0;
    rects[k + 2] = synced ? c1 : -1;
    rects[k + 3] = synced ? r1 : -1;
  }
}
