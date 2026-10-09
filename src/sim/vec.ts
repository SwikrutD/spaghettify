/** A point or direction on the play plane (world X and Z; Y is up and the simulation never uses it). */
export interface Vec2 {
  x: number;
  z: number;
}

export function vec2(x = 0, z = 0): Vec2 {
  return { x, z };
}
