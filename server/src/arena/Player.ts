import type { OverMessage, ServerMessage } from '../../../src/protocol/messages.ts';
import type { Hole } from '../../../src/sim/Hole.ts';
import type { Interest } from './Interest.ts';
import type { Room } from './Room.ts';

/** Where a player's messages go: a WebSocket, or a test's recorder. */
export interface Link {
  /** A binary frame (snapshot). */
  binary(data: Uint8Array): void;
  json(message: ServerMessage): void;
  /** Bytes queued for the client and not sent yet. */
  readonly buffered: number;
  close(code: number, reason: string): void;
}

/** One connected player: its hole in a room, what it was told (interest), its input and its life. */
export class Player {
  readonly link: Link;
  room: Room | null = null;
  hole: Hole | null = null;
  interest: Interest | null = null;
  /** True if the hole plays under the player's own nickname (its lives go on the global leaderboard). */
  named = false;
  /** Screen reach (see NET.interest) the player asked for, clamped. */
  reach = 0;
  /** Seq of the newest input taken, and of the newest one a world step has used (sent back as the ack). */
  lastSeq = 0;
  ack = 0;
  /** World time the current life ended, or -1 while it lasts. */
  overAt = -1;
  /** True once the current life was scored (posted or not), so it is never scored twice. */
  scored = false;
  /** The scored life, sent after the snapshot that carries its end. */
  pendingOver: OverMessage | null = null;

  constructor(link: Link) {
    this.link = link;
  }
}
