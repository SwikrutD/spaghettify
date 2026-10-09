// Screen-space gravitational lens around the black hole, shared by the lensing post pass and the
// accretion disk. Thin point-mass lens: a ray seen at image radius r passed the hole and was bent
// by alpha(r), so it came from source radius r - alpha(r). Inside the Einstein radius that value
// is negative: the light came from the opposite side (the flipped secondary image).
// Distances on screen are in player radii (the black core's on-screen radius); depths in player radii.

// Einstein radius for the far background (stars) and for things on the play plane.
uniform float uLensEinstein;
uniform float uLensPlaneEinstein;
uniform float uLensFalloff;
uniform float uLensRadius;
// Play-plane bending ramps from zero, uLensDepthSoft in front of the hole, to full, uLensDepthRange behind it.
uniform float uLensDepthRange;
uniform float uLensDepthSoft;

// 1 at the centre, falling to 0 with zero slope at uLensRadius.
float lensWindow(float r) {
  float u = min(r / uLensRadius, 1.0);
  float k = 1.0 - u * u;
  return k * k;
}

// Deflection at image radius r for a lens with the given Einstein radius, scaled by weight.
float lensDeflection(float r, float einstein, float weight) {
  return weight * einstein * pow(einstein / max(r, 1e-3), uLensFalloff) * lensWindow(r);
}

// Real lensing grows with the source's distance behind the lens, so nothing in front of the hole
// bends. `behind` is in player radii along the view axis.
float lensDepthWeight(float behind) {
  return smoothstep(-uLensDepthSoft, uLensDepthRange, behind);
}

// Forward map for geometry: the primary image radius of a source at radius b, the r > b that solves
// r - alpha(r) = b. Starts from the exact point-mass answer and refines with Newton steps.
float lensImageRadius(float b, float einstein, float weight) {
  float r = 0.5 * (b + sqrt(b * b + 4.0 * weight * einstein * einstein));
  for (int i = 0; i < 3; i++) {
    float u = min(r / uLensRadius, 1.0);
    float k = 1.0 - u * u;
    float powerLaw = weight * einstein * pow(einstein / r, uLensFalloff);
    float alpha = powerLaw * k * k;
    // d(alpha)/dr is never positive, so the steps are well behaved.
    float slope = -uLensFalloff * alpha / r - powerLaw * 4.0 * u * k / uLensRadius;
    r -= (r - alpha - b) / (1.0 - slope);
  }
  return r;
}
