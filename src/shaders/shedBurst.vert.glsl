// Fragments thrown off the disk on a hit. Size is in world units; uPointScale converts to pixels.
attribute float aLife; // 1 at birth, 0 when gone
attribute float aSize;
uniform float uPointScale;
varying float vLife;

void main() {
  vLife = aLife;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aLife > 0.0 ? aSize * (0.4 + 0.6 * aLife) * uPointScale / -mv.z : 0.0;
}
