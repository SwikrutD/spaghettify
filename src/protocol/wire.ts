// Binary building blocks of the online protocol, shared by the server and the game (pure: no DOM, no Node APIs).
// Little-endian throughout.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** A growing byte buffer to write a message into. Reuse one with reset(); bytes() copies the message out. */
export class Writer {
  private buf: Uint8Array;
  private view: DataView;
  length = 0;

  constructor(capacity = 4096) {
    this.buf = new Uint8Array(capacity);
    this.view = new DataView(this.buf.buffer);
  }

  reset(): this {
    this.length = 0;
    return this;
  }

  u8(v: number): void {
    this.ensure(1);
    this.buf[this.length++] = v;
  }

  i8(v: number): void {
    this.ensure(1);
    this.view.setInt8(this.length++, v);
  }

  u16(v: number): void {
    this.ensure(2);
    this.view.setUint16(this.length, v, true);
    this.length += 2;
  }

  i16(v: number): void {
    this.ensure(2);
    this.view.setInt16(this.length, v, true);
    this.length += 2;
  }

  u32(v: number): void {
    this.ensure(4);
    this.view.setUint32(this.length, v >>> 0, true);
    this.length += 4;
  }

  f32(v: number): void {
    this.ensure(4);
    this.view.setFloat32(this.length, v, true);
    this.length += 4;
  }

  /** An unsigned integer (up to 2^53) in 7-bit groups, small values first: 1 byte below 128, 2 below 16384. */
  varint(v: number): void {
    while (v >= 0x80) {
      this.u8((v & 0x7f) | 0x80);
      v = Math.floor(v / 128);
    }
    this.u8(v);
  }

  /** UTF-8 text with its byte length in front (names and labels: at most 4096 characters are kept). */
  string(s: string): void {
    if (s.length > 4096) s = s.slice(0, 4096);
    this.ensure(s.length * 3 + 5);
    const at = this.length;
    // The length is not known until it is encoded: leave room for a 2-byte varint and move the text if it is shorter.
    const { written } = encoder.encodeInto(s, this.buf.subarray(at + 2));
    if (written < 0x80) {
      this.buf.copyWithin(at + 1, at + 2, at + 2 + written);
      this.buf[at] = written;
      this.length = at + 1 + written;
    } else {
      this.buf[at] = (written & 0x7f) | 0x80;
      this.buf[at + 1] = written >>> 7;
      this.length = at + 2 + written;
    }
  }

  /** Room for a u16 to fill in later (a count not known yet); returns where it is. */
  reserveU16(): number {
    this.ensure(2);
    const at = this.length;
    this.length += 2;
    return at;
  }

  patchU16(at: number, v: number): void {
    this.view.setUint16(at, v, true);
  }

  patchU8(at: number, v: number): void {
    this.buf[at] = v;
  }

  /** A copy of what was written (safe to hand to a socket while the writer is reused). */
  bytes(): Uint8Array {
    return this.buf.slice(0, this.length);
  }

  private ensure(n: number): void {
    if (this.length + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.length + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }
}

/** Reads what a Writer wrote, in the same order. Reading past the end throws (a malformed message). */
export class Reader {
  private readonly buf: Uint8Array;
  private readonly view: DataView;
  offset = 0;

  constructor(bytes: Uint8Array) {
    this.buf = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get remaining(): number {
    return this.buf.length - this.offset;
  }

  u8(): number {
    this.need(1);
    return this.buf[this.offset++];
  }

  i8(): number {
    this.need(1);
    return this.view.getInt8(this.offset++);
  }

  u16(): number {
    this.need(2);
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }

  i16(): number {
    this.need(2);
    const v = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return v;
  }

  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  f32(): number {
    this.need(4);
    const v = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return v;
  }

  varint(): number {
    let v = 0;
    let scale = 1;
    for (let i = 0; i < 8; i++) {
      const b = this.u8();
      v += (b & 0x7f) * scale;
      if (b < 0x80) return v;
      scale *= 128;
    }
    throw new RangeError('varint too long');
  }

  string(): string {
    const n = this.varint();
    this.need(n);
    const s = decoder.decode(this.buf.subarray(this.offset, this.offset + n));
    this.offset += n;
    return s;
  }

  private need(n: number): void {
    if (this.offset + n > this.buf.length) throw new RangeError('message too short');
  }
}

/**
 * A positive number (radius, mass) in a u16 on a log scale: 2^(u / 2048 - 10), so 0.001 to 4 million at 0.034
 * percent steps. 0 is kept for 0.
 */
export function packLog(v: number): number {
  if (!(v > 0)) return 0;
  const u = Math.round((Math.log2(v) + 10) * 2048);
  return u < 1 ? 1 : u > 0xffff ? 0xffff : u;
}

export function unpackLog(u: number): number {
  return u === 0 ? 0 : Math.pow(2, u / 2048 - 10);
}

/** 0..1 in a byte, and back. */
export function packUnit(v: number): number {
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
}

export function unpackUnit(u: number): number {
  return u / 255;
}

/** Seconds of a short timer (0 to 5.1 s) in a byte, in 1/50 s steps (rounded up, so a running timer never reads 0). */
export function packTimer(seconds: number): number {
  return seconds <= 0 ? 0 : Math.min(255, Math.ceil(seconds * 50));
}

export function unpackTimer(u: number): number {
  return u / 50;
}

/**
 * A timer the sim counts down by `dt` a step (`t = max(0, t - dt)`), exact to the step, in a byte: 0 when it is not
 * running, else 1 + the steps it stays above zero (up to 254). The value decoded is half a step past that many steps,
 * so a copy counted down the same way runs out on the very step the original does, whether its rule reads the timer
 * before or after counting it down. The own hole's stun and invulnerability need this: a bounce predicted a step early
 * or late is a visible correction.
 */
export function packSteps(seconds: number, dt: number): number {
  if (seconds <= 0) return 0;
  let steps = 0;
  let t = seconds;
  while (steps < 253 && (t = Math.max(0, t - dt)) > 0) steps++;
  return steps + 1;
}

export function unpackSteps(u: number, dt: number): number {
  return u === 0 ? 0 : (u - 0.5) * dt;
}
