// Physically inspired thin accretion disk, drawn additively.
// - Temperature follows the Shakura-Sunyaev profile T ~ r^-3/4 * (1 - k*sqrt(rin/r))^1/4.
// - Colour is the blackbody colour of the Doppler-shifted temperature.
// - Relativistic beaming: the side orbiting toward the camera is brighter and bluer.
// - Gas orbits with Keplerian angular speed (omega ~ r^-3/2). Differential rotation would wind
//   the turbulence up forever, so two flow phases are cross-faded (the flow map trick).

#include lib/simplex3d.glsl
#include lib/blackbody.glsl

uniform float uTime;
uniform float uInner;
uniform float uOuter;
uniform vec3 uCamLocal;
uniform float uSpin;
uniform float uOmegaInner;
uniform float uFlowPeriod;
uniform float uBeta;
uniform float uBeamingPower;
uniform float uTorque;
uniform float uProfilePeak;
uniform float uPeakKelvin;
uniform float uTempIntensityPower;
uniform float uBrightness;
uniform float uNoiseRadialFreq;
uniform float uNoiseAngularFreq;
uniform float uSpiralTwist;
uniform float uContrast;
uniform float uSaturation;
uniform float uOuterSoftness;
uniform float uLayerFalloff;
uniform float uLayerNorm;

varying vec3 vLocal;
varying float vLayer;

float fbm(vec3 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < NOISE_OCTAVES; i++) {
    sum += amp * snoise(p);
    p = p * 2.03 + vec3(1.7, -3.1, 0.6);
    amp *= 0.5;
  }
  return sum;
}

// Turbulence sampled in polar coordinates. The angle goes through cos/sin so it wraps seamlessly;
// radius goes through log so streak width scales with radius.
float turbulence(float logR, float angle, float seed) {
  float a = angle + logR * uSpiralTwist;
  vec3 p = vec3(cos(a) * uNoiseAngularFreq, sin(a) * uNoiseAngularFreq, logR * uNoiseRadialFreq);
  return fbm(p + vec3(seed * 7.13, seed * 3.71, seed * 1.37 + vLayer * 0.8));
}

float hash11(float n) {
  return fract(sin(n * 127.1) * 43758.5453);
}

void main() {
  float r = length(vLocal.xy);
  float x = uInner / r;
  float angle = atan(vLocal.y, vLocal.x);
  float logR = log(r);

  // Keplerian flow with two cross-faded phases. Each new cycle samples a fresh patch of noise.
  float omega = uSpin * uOmegaInner * x * sqrt(x);
  float cycle = uTime / uFlowPeriod;
  float c0 = fract(cycle);
  float c1 = fract(cycle + 0.5);
  float w0 = 1.0 - abs(2.0 * c0 - 1.0);
  float n0 = turbulence(logR, angle - omega * c0 * uFlowPeriod, hash11(floor(cycle)));
  float n1 = turbulence(logR, angle - omega * c1 * uFlowPeriod, hash11(floor(cycle + 0.5) + 31.0));
  // Cross-fading two noises lowers their contrast; the 1.4 restores it roughly.
  float n = (n0 * w0 + n1 * (1.0 - w0)) * 1.4;

  // Temperature profile, normalised so its peak is 1.
  float temp = pow(x, 0.75) * pow(max(1.0 - uTorque * sqrt(x), 0.0), 0.25) / uProfilePeak;

  // Doppler factor D = 1 / (gamma * (1 - beta * cos(theta))).
  vec3 tangent = uSpin * vec3(-vLocal.y, vLocal.x, 0.0) / r;
  vec3 toCam = normalize(uCamLocal - vLocal);
  float beta = uBeta * sqrt(x);
  float gammaInv = sqrt(1.0 - beta * beta);
  float doppler = gammaInv / (1.0 - beta * dot(tangent, toCam));

  float clumps = clamp(1.0 + n * uContrast, 0.05, 2.0);
  float observedTemp = temp * doppler * (0.92 + 0.08 * clumps);
  vec3 color = blackbody(uPeakKelvin * observedTemp);
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = max(mix(vec3(luma), color, uSaturation), 0.0);
  float intensity = uBrightness * pow(temp, uTempIntensityPower) * pow(doppler, uBeamingPower) * clumps;

  // Edges: a crisp inner rim, a soft wispy outer edge.
  float innerEdge = smoothstep(0.0, 0.03, r - uInner);
  float outerT = (r - uInner) / (uOuter - uInner);
  float outerEdge = 1.0 - smoothstep(1.0 - uOuterSoftness, 1.0, outerT + n * 0.12);
  float layerWeight = exp(-uLayerFalloff * vLayer * vLayer) * uLayerNorm;

  float alpha = innerEdge * outerEdge * layerWeight;
  gl_FragColor = vec4(color * intensity, alpha);
}
