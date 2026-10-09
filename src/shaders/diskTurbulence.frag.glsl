// Accretion disk turbulence, rendered once per frame into a small polar map (u = angle, v = log
// radius between uLogRange.x and .y; one channel per disk layer) that the disk then samples.
// The turbulence depends only on angle, radius, layer and time, so evaluating it here instead of
// in every disk fragment of every layer makes its cost independent of the screen resolution.
// - Gas orbits with Keplerian angular speed (omega ~ r^-3/2). Differential rotation would wind
//   the turbulence up forever, so two flow phases are cross-faded (the flow map trick).

#include lib/simplex3d.glsl

uniform float uTime;
uniform float uInner;
uniform float uSpin;
uniform float uOmegaInner;
uniform float uFlowPeriod;
uniform float uNoiseRadialFreq;
uniform float uNoiseAngularFreq;
uniform float uSpiralTwist;
uniform vec2 uLogRange;
// Noise octaves (1 to MAX_OCTAVES), live layer count (1 to 3) and each layer's height in -1..1.
uniform int uOctaves;
uniform int uLayers;
uniform vec3 uLayerHeights;

varying vec2 vUv;

// Normalised to the amplitude of the full three-octave sum, so fewer octaves lose detail, not contrast.
float fbm(vec3 p, int octaves) {
  float sum = 0.0;
  float amp = 0.5;
  float total = 0.0;
  for (int i = 0; i < MAX_OCTAVES; i++) {
    if (i >= octaves) break;
    sum += amp * snoise(p);
    total += amp;
    p = p * 2.03 + vec3(1.7, -3.1, 0.6);
    amp *= 0.5;
  }
  return sum * (0.875 / total);
}

// Turbulence sampled in polar coordinates. The angle goes through cos/sin so it wraps seamlessly;
// radius goes through log so streak width scales with radius.
float turbulence(float logR, float angle, float seed, float layer, int octaves) {
  float a = angle + logR * uSpiralTwist;
  vec3 p = vec3(cos(a) * uNoiseAngularFreq, sin(a) * uNoiseAngularFreq, logR * uNoiseRadialFreq);
  return fbm(p + vec3(seed * 7.13, seed * 3.71, seed * 1.37 + layer * 0.8), octaves);
}

float hash11(float n) {
  return fract(sin(n * 127.1) * 43758.5453);
}

// Cross-faded Keplerian flow for one layer. Each new cycle samples a fresh patch of noise.
float layerNoise(float logR, float angle, float layer) {
  float x = uInner / exp(logR);
  float omega = uSpin * uOmegaInner * x * sqrt(x);
  float cycle = uTime / uFlowPeriod;
  float c0 = fract(cycle);
  float c1 = fract(cycle + 0.5);
  float w0 = 1.0 - abs(2.0 * c0 - 1.0);
  // The outer layers are faint (see uLayerFalloff); their finest octave is not visible, so skip it.
  int octaves = abs(layer) > 0.75 ? max(uOctaves - 1, 1) : uOctaves;
  float n0 = turbulence(logR, angle - omega * c0 * uFlowPeriod, hash11(floor(cycle)), layer, octaves);
  float n1 = turbulence(logR, angle - omega * c1 * uFlowPeriod, hash11(floor(cycle + 0.5) + 31.0), layer, octaves);
  // Cross-fading two noises lowers their contrast; the 1.4 restores it roughly.
  return (n0 * w0 + n1 * (1.0 - w0)) * 1.4;
}

void main() {
  // Texel centres sit at u = (i + 0.5) / width; the angle runs from -pi to pi like atan in the disk.
  float angle = (vUv.x * 2.0 - 1.0) * 3.14159265;
  float logR = mix(uLogRange.x, uLogRange.y, vUv.y);
  vec3 n = vec3(0.0);
  n.x = layerNoise(logR, angle, uLayerHeights.x);
  if (uLayers > 1) n.y = layerNoise(logR, angle, uLayerHeights.y);
  if (uLayers > 2) n.z = layerNoise(logR, angle, uLayerHeights.z);
  gl_FragColor = vec4(n, 1.0);
}
