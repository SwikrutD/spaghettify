// Vertex-stage lensing for meshes that are part of the hole (the accretion disk). They are drawn
// after the lensing post pass, on top of the bent image, so they bend themselves here instead:
// each vertex moves to its primary image, bent like anything else on the play plane. Bending per
// vertex is a continuous warp, so the disk bends by its own depth (far side lifted, near side
// untouched) without tearing.
// Assumes the mesh's local origin is the hole's centre and its model scale is the player radius.

#include lens.glsl

uniform float uLensOn;

vec4 lensWarp(vec4 clip, vec4 viewPos) {
  if (uLensOn < 0.5) return clip;
  vec4 centreView = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec4 centreClip = projectionMatrix * centreView;
  float playerRadius = length(modelMatrix[0].xyz);

  // Screen space with round circles: NDC scaled by aspect in x. Core radius from the sphere's silhouette.
  vec2 aspect = vec2(projectionMatrix[1][1] / projectionMatrix[0][0], 1.0);
  float sinCore = min(playerRadius / length(centreView.xyz), 0.99);
  float coreRadius = sinCore / sqrt(1.0 - sinCore * sinCore) * projectionMatrix[1][1];

  vec2 centre = centreClip.xy / centreClip.w * aspect;
  vec2 offset = (clip.xy / clip.w * aspect - centre) / coreRadius;
  float b = length(offset);
  if (b < 1e-4) return clip;

  float behind = (centreView.z - viewPos.z) / playerRadius;
  float r = lensImageRadius(b, uLensPlaneEinstein, lensDepthWeight(behind));
  vec2 ndc = (centre + offset * (r / b) * coreRadius) / aspect;
  return vec4(ndc * clip.w, clip.zw);
}
