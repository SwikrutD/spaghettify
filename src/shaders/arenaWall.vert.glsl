// The gas wall at the arena edge: a flat annulus on the play plane, from inside the soft edge out far past it.
varying vec2 vWorld; // world x, z

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
