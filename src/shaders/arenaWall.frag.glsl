// The gas wall at the arena edge: dense, slowly churning gas past the edge with a glowing inner face, and thin
// wisps inside it where the push begins. Everything is measured in the viewer's view distance (uView), so the wall
// reads the same from a pea to a planet-eater: its soft band is the band where the sim pushes the local hole back.
// Noise scales are tied to powers of two of the view and cross-faded, so growing never makes the pattern pop.
// Output is premultiplied: the gas both glows and hides what is behind it. Alpha is left to the blend state.
#include lib/simplex3d.glsl

uniform float uRadius;  // arena radius
uniform float uView;    // the viewer's view distance
uniform float uWidth;   // soft edge width for the viewer (world units)
uniform float uTime;
uniform vec3 uGlow;     // HDR colour of the lit inner face
uniform vec3 uGas;      // colour of the dense gas
uniform float uOpacity; // how much the dense gas hides behind it
varying vec2 vWorld;

float fbm(vec2 p, float t) {
  float n = snoise(vec3(p, t)) * 0.55;
  n += snoise(vec3(p * 2.1 + 7.3, t * 1.4)) * 0.3;
  n += snoise(vec3(p * 4.3 - 3.1, t * 1.9)) * 0.15;
  return n * 0.5 + 0.5;
}

/** Noise at the scale of a power-of-two view, cross-faded with the next one up. */
float churn(vec2 p) {
  float s = log2(uView);
  float f = floor(s);
  float w = s - f;
  float a = fbm(p / exp2(f) * 1.5, uTime * 0.05);
  float b = fbm(p / exp2(f + 1.0) * 1.5 + 11.0, uTime * 0.05 + 3.0);
  return mix(a, b, smoothstep(0.0, 1.0, w));
}

void main() {
  float d = length(vWorld);
  float n = churn(vWorld);
  // Signed distance past the edge, in soft widths, roughened by the noise so the face billows.
  float depth = (d - uRadius) / uWidth + (n - 0.5) * 0.9;
  // Wisps start a soft width inside the edge; past it the gas is dense.
  float density = smoothstep(-1.0, 0.6, depth) * (0.55 + 0.45 * n);
  float face = exp(-abs(depth - 0.1) * 2.2) * (0.35 + 0.65 * n);
  vec3 glow = uGlow * face * (0.4 + 0.6 * smoothstep(-1.0, 0.2, depth));
  float alpha = clamp(density * uOpacity, 0.0, 1.0);
  gl_FragColor = vec4(uGas * density * alpha + glow * (1.0 - 0.5 * alpha), alpha);
}
