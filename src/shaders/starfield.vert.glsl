attribute float aSize;
attribute float aBright;
uniform vec2 uCentre;
uniform float uScale;
uniform float uExtent;
varying float vBright;

void main() {
  vBright = aBright;
  // The star field scales with the view and wraps around the player, so it never runs out.
  float e = uExtent * uScale;
  vec2 xz = position.xz * uScale;
  xz = uCentre + mod(xz - uCentre + e, 2.0 * e) - e;
  vec4 mv = modelViewMatrix * vec4(xz.x, position.y * uScale, xz.y, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * (300.0 * uScale / -mv.z);
}
