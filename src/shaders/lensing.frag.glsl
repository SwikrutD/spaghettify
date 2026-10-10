// Gravitational lensing post pass. Bends the rendered scene around the black hole and writes the
// bent depth, so the hole's own parts (drawn next) and CorePass depth-test against the bent image.
// The hole itself is not in the input image: its core, disk and photon ring are drawn afterwards.
//
// Two layers. The far background (stars, empty sky) bends at full strength. Things on the play
// plane (prey) bend by how far behind the hole the plane is at that pixel, so prey in front of the
// hole stay put and prey behind it arc around. The scene's alpha tells them apart: plane objects
// write 1, the cleared sky is 0 and the stars leave it alone. Filtered alpha also marks the
// edge texels, so a bilinear background sample never drags in a sliver of a prey.

#include lib/lens.glsl

uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform float uLensOn;
// Lens centre in uv, and the scale from a uv offset to player radii (aspect corrected).
uniform vec2 uCentre;
uniform vec2 uUvToLens;
uniform vec2 uTexel;
// Supersample inside this radius (player radii), where the image is squeezed hardest, with this many
// samples (1 to 4; a uniform so the quality level can change without a recompile).
uniform float uSampleZone;
uniform int uLensSamples;
// Play plane in view space, to find how far behind the hole it is at each pixel.
uniform vec2 uTanHalfFov;
uniform vec3 uPlaneNormal;
uniform vec3 uLensView;
uniform float uPlayerRadius;
// Further lenses (the nearest other holes on screen), each with its own centre, scale to its core radii, view-space
// centre and radius. Their deflections add to the main lens's, a good approximation for holes far apart.
#define MAX_EXTRA 2
uniform int uExtraCount;
uniform vec2 uExtraCentre[MAX_EXTRA];
uniform vec2 uExtraUvToLens[MAX_EXTRA];
uniform vec3 uExtraView[MAX_EXTRA];
uniform float uExtraRadius[MAX_EXTRA];

varying vec2 vUv;

// Rotated grid. Taking the first two gives a diagonal pair.
const vec2 SAMPLE_OFFSETS[4] = vec2[](vec2(0.125, 0.375), vec2(-0.125, -0.375), vec2(0.375, -0.125), vec2(-0.375, 0.125));

// How far behind a hole (its radii, along the view axis) the play plane is at this pixel.
float planeBehind(vec2 uv, vec3 lensView, float holeRadius) {
  vec3 ray = vec3((uv * 2.0 - 1.0) * uTanHalfFov, -1.0);
  float facing = dot(uPlaneNormal, ray);
  if (facing > -1e-4) return 1e4;
  float depth = dot(uPlaneNormal, lensView) / facing;
  return (depth + lensView.z) / holeRadius;
}

bool onScreen(vec2 uv) {
  return all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)));
}

// Bent colour and depth seen at uv. One exit and explicit LOD (the targets have no mipmaps) keep
// the D3D shader compiler quiet about derivatives in the supersampling loop.
vec3 lensSample(vec2 uv, out float depth) {
  // How far (in uv) the light seen here was bent, for the play plane and for the far background, summed over the lenses.
  vec2 offset = (uv - uCentre) * uUvToLens;
  float r = max(length(offset), 1e-4);
  vec2 dir = offset / r;
  bool inCore = r < 1.0;
  float deflection = lensDeflection(r, uLensPlaneEinstein, lensDepthWeight(planeBehind(uv, uLensView, uPlayerRadius)));
  vec2 shiftPlane = dir * deflection / uUvToLens;
  vec2 shiftFar = dir * lensDeflection(r, uLensEinstein, 1.0) / uUvToLens;
  // Over a core only a primary image may show (a prey in front of the hole). A flipped secondary image there would be
  // light that fell into the hole.
  bool flipped = inCore && r <= deflection;
  for (int i = 0; i < MAX_EXTRA; i++) {
    if (i >= uExtraCount) break;
    vec2 eo = (uv - uExtraCentre[i]) * uExtraUvToLens[i];
    float er = max(length(eo), 1e-4);
    if (er >= uLensRadius) continue;
    vec2 edir = eo / er;
    float ed = lensDeflection(er, uLensPlaneEinstein, lensDepthWeight(planeBehind(uv, uExtraView[i], uExtraRadius[i])));
    shiftPlane += edir * ed / uExtraUvToLens[i];
    shiftFar += edir * lensDeflection(er, uLensEinstein, 1.0) / uExtraUvToLens[i];
    inCore = inCore || er < 1.0;
    flipped = flipped || (er < 1.0 && er <= ed);
  }

  depth = 1.0;
  vec3 color = vec3(0.0);
  // Play plane first, since it is in front of the background.
  vec2 uvPlane = uv - shiftPlane;
  vec4 plane = onScreen(uvPlane) ? textureLod(tColor, uvPlane, 0.0) : vec4(0.0);
  if (plane.a > 0.5 && !flipped) {
    color = plane.rgb;
    depth = textureLod(tDepth, uvPlane, 0.0).x;
  } else if (!inCore) {
    // (Inside a core the colour does not matter: the core is drawn over it afterwards.)
    vec2 uvFar = uv - shiftFar;
    // Light from beyond the screen edge is unknown; it is mostly dark sky.
    if (onScreen(uvFar)) {
      vec4 far = textureLod(tColor, uvFar, 0.0);
      // If that background is hidden behind a plane object in the unbent image, fall back to the
      // background bent like the plane (clear there, or we would have used it above) rather than
      // leave a dark gap.
      color = far.a == 0.0 ? far.rgb : plane.rgb;
    }
  }
  return color;
}

// True if the pixel is inside the window of the main lens or of one of the extra ones.
bool inLensWindow(vec2 uv) {
  if (length((uv - uCentre) * uUvToLens) < uLensRadius) return true;
  for (int i = 0; i < MAX_EXTRA; i++) {
    if (i >= uExtraCount) break;
    if (length((uv - uExtraCentre[i]) * uExtraUvToLens[i]) < uLensRadius) return true;
  }
  return false;
}

void main() {
  float r = length((vUv - uCentre) * uUvToLens);
  vec3 color;
  float depth;
  if (uLensOn < 0.5 || !inLensWindow(vUv)) {
    color = textureLod(tColor, vUv, 0.0).rgb;
    depth = textureLod(tDepth, vUv, 0.0).x;
  } else if (uLensSamples > 1 && r < uSampleZone) {
    // Supersampled. The core's depth test uses the first sample's depth (under half a texel off centre).
    color = lensSample(vUv + SAMPLE_OFFSETS[0] * uTexel, depth);
    float sampleDepth;
    for (int i = 1; i < 4; i++) {
      if (i >= uLensSamples) break;
      color += lensSample(vUv + SAMPLE_OFFSETS[i] * uTexel, sampleDepth);
    }
    color /= float(uLensSamples);
  } else {
    color = lensSample(vUv, depth);
  }
  gl_FragColor = vec4(color, 1.0);
  gl_FragDepth = depth;
}
