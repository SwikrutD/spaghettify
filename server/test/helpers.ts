import type { ServerMessage } from '../../src/protocol/messages.ts';
import { readSnapshot, type NetBody, type NetHole, type NetRect, type Snapshot } from '../../src/protocol/snapshot.ts';
import type { SimEvent } from '../../src/sim/events.ts';
import { World } from '../../src/sim/World.ts';
import type { Link } from '../src/arena/Player.ts';

/**
 * What a client would build from the server's messages: the holes, pooled bodies and field cells it was told about,
 * kept the way the protocol says (src/protocol/snapshot.ts). The field is a real MatterField of a world made from
 * the same seed, so its grains can be compared with the server's one for one.
 */
export class Mirror {
  readonly holes = new Map<number, NetHole & { gen: number; name: string }>();
  /** Per body kind: slot to the last record. */
  readonly bodies: Map<number, NetBody>[] = [new Map(), new Map(), new Map(), new Map()];
  readonly rects = new Map<number, NetRect>();
  readonly events: SimEvent[] = [];
  readonly world: World;
  last: Snapshot | null = null;

  constructor(seed: number) {
    this.world = new World({ seed, local: false });
    // As the seed lays it out (the world's own bodies covered some grains; a client knows only what it is told).
    this.world.field.reset();
  }

  apply(s: Snapshot): void {
    this.last = s;
    for (const h of s.holes) {
      const known = this.holes.get(h.id);
      if (h.gen === null && !known) throw new Error(`hole ${h.id} sent without an intro`);
      this.holes.set(h.id, { ...h, gen: h.gen ?? known!.gen, name: h.name ?? known!.name });
    }
    for (const id of s.gone) this.holes.delete(id);
    for (const b of s.bodies) {
      if (b.state === null) this.bodies[b.kind].delete(b.slot);
      else this.bodies[b.kind].set(b.slot, b);
    }
    const field = this.world.field;
    for (const r of s.rects) {
      const before = this.rects.get(r.layer);
      const layer = field.layers[r.layer];
      // Cells entering the rectangle start as the seed laid them out.
      for (let row = r.r0; row <= r.r1; row++) {
        for (let col = r.c0; col <= r.c1; col++) {
          if (before && row >= before.r0 && row <= before.r1 && col >= before.c0 && col <= before.c1) continue;
          field.setCell(r.layer, row * layer.cols + col, 0, 0);
        }
      }
      this.rects.set(r.layer, r);
    }
    for (const c of s.cells) field.setCell(c.layer, c.cell, c.taken, c.epoch);
    this.events.push(...s.events);
  }
}

/** A Link that keeps what the room sends (snapshots decoded) and can feed a Mirror. */
export class TestLink implements Link {
  readonly json: (message: ServerMessage) => void;
  readonly messages: ServerMessage[] = [];
  readonly snapshots: Snapshot[] = [];
  bytes = 0;
  buffered = 0;
  closed: { code: number; reason: string } | null = null;
  mirror: Mirror | null = null;

  constructor() {
    this.json = (message) => {
      // As it would go over the wire.
      this.messages.push(JSON.parse(JSON.stringify(message)) as ServerMessage);
    };
  }

  binary(data: Uint8Array): void {
    this.bytes += data.length;
    const s = readSnapshot(data);
    this.snapshots.push(s);
    this.mirror?.apply(s);
  }

  close(code: number, reason: string): void {
    this.closed = { code, reason };
  }

  /** Messages of one type. */
  of<T extends ServerMessage['t']>(t: T): Extract<ServerMessage, { t: T }>[] {
    return this.messages.filter((m): m is Extract<ServerMessage, { t: T }> => m.t === t);
  }
}
