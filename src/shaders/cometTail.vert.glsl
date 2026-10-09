// Comet tail and coma: a flat quad on the play plane per comet (instanced). The instance matrix puts the
// origin on the nucleus with local +x pointing back along the tail. Local x in -1..0 covers the coma ahead
// of the nucleus, 0..1 the tail; local z in -1..1 spans the widest part.
attribute vec4 aShape; // tail length, half width at the head, coma radius, fade (0..1)
attribute float aSeed;
uniform float uFlare;
varying vec2 vLocal;   // world units from the nucleus: x along the tail, y across
varying vec2 vQuad;    // -1..1 across the quad, to fade every edge to zero
varying vec4 vShape;
varying float vSeed;

void main() {
  float len = aShape.x;
  float halfWidth = max(aShape.z, aShape.y * (1.0 + uFlare));
  float x = position.x < 0.0 ? position.x * aShape.z : position.x * len;
  float z = position.z * halfWidth;
  vLocal = vec2(x, z);
  vQuad = position.xz;
  vShape = aShape;
  vSeed = aSeed;
  vec4 world = modelMatrix * instanceMatrix * vec4(x, 0.0, z, 1.0);
  gl_Position = projectionMatrix * viewMatrix * world;
}
