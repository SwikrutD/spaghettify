// Accretion disk. The source geometry is a ring from radius 1 to 2 in the local XY plane, stacked
// in a few layers (aLayer in -1..1). It is remapped here to [uInner, uOuter] so the mesh always
// hugs the visible disk, and the layers are pushed apart in Z to give a flared, thick disk.
// Local units are player radii (the black core has radius 1). Local +Z is world up.
// The disk is drawn over the lensed scene, so it applies the gravitational lens to itself.

#include lib/lensVertex.glsl

attribute float aLayer;
// Which channel of the turbulence map holds this layer (0, 1 or 2).
attribute float aChannel;

uniform float uInner;
uniform float uOuter;
uniform float uThickness;

varying vec3 vLocal;
varying float vLayer;
varying vec3 vMask;

void main() {
  float s = length(position.xy);
  vec2 dir = position.xy / s;
  float r = mix(uInner, uOuter, s - 1.0);
  // Flared: thin at the inner edge, thickest at the outer edge.
  float flare = smoothstep(0.0, 1.0, (r - uInner) / (uOuter - uInner));
  vec3 p = vec3(dir * r, aLayer * uThickness * flare);

  vLocal = p;
  vLayer = aLayer;
  vMask = vec3(equal(vec3(aChannel), vec3(0.0, 1.0, 2.0)));
  vec4 viewPos = modelViewMatrix * vec4(p, 1.0);
  gl_Position = lensWarp(projectionMatrix * viewPos, viewPos);
}
