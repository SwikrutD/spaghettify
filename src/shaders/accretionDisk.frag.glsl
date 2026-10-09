// Physically inspired thin accretion disk, drawn additively.
// - Temperature follows the Shakura-Sunyaev profile T ~ r^-3/4 * (1 - k*sqrt(rin/r))^1/4.
// - Colour is the blackbody colour of the Doppler-shifted temperature.
// - Relativistic beaming: the side orbiting toward the camera is brighter and bluer.
// - Turbulence (Keplerian flow, see diskTurbulence.frag.glsl) comes from a polar map rendered
//   once per frame, one channel per layer.

#include lib/blackbody.glsl

uniform float uInner;
uniform float uOuter;
uniform vec3 uCamLocal;
uniform float uSpin;
uniform float uBeta;
uniform float uBeamingPower;
uniform float uTorque;
uniform float uProfilePeak;
uniform float uPeakKelvin;
uniform float uTempIntensityPower;
uniform float uBrightness;
uniform float uContrast;
uniform float uSaturation;
uniform float uOuterSoftness;
uniform float uLayerFalloff;
uniform float uLayerNorm;
// Turbulence map: u = angle, v = log radius from uTurbLogRange.x to .y; vMask picks this layer's channel.
uniform sampler2D tTurbulence;
uniform vec2 uTurbLogRange;

varying vec3 vLocal;
varying float vLayer;
varying vec3 vMask;

void main() {
  float r = length(vLocal.xy);
  float x = uInner / r;
  float angle = atan(vLocal.y, vLocal.x);
  float logR = log(r);

  vec2 turbUv = vec2(angle * 0.15915494 + 0.5, (logR - uTurbLogRange.x) / (uTurbLogRange.y - uTurbLogRange.x));
  // Explicit LOD: the map has no mipmaps, and the angle wraps (no derivative trouble at the seam).
  float n = dot(textureLod(tTurbulence, turbUv, 0.0).rgb, vMask);

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
