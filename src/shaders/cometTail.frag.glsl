// A straight, streaky blue ion tail, a broader curved warm dust tail and a bright coma. HDR, additive.
// Drawn after the lensing pass (OVERLAY_LAYER) with alpha left untouched.
uniform vec3 uIonColor;
uniform vec3 uDustColor;
uniform float uFlare;
uniform float uTime;
varying vec2 vLocal;
varying vec2 vQuad;
varying vec4 vShape;
varying float vSeed;

void main() {
  float len = vShape.x;
  float headWidth = vShape.y;
  float coma = vShape.z;
  float fade = vShape.w;
  float t = clamp(vLocal.x / len, 0.0, 1.0);
  float behind = step(0.0, vLocal.x);
  float width = headWidth * (1.0 + uFlare * t);

  // Ion tail: narrow, straight, with drifting streaks.
  float ionAcross = vLocal.y / (width * 0.35);
  float streaks = 0.65 + 0.35 * sin(vLocal.y / headWidth * 5.0 + vSeed * 17.0 - uTime * 0.7)
                       * sin(vLocal.x / len * 9.0 - uTime * 2.3 + vSeed * 5.0);
  float ion = exp(-ionAcross * ionAcross * 2.5) * pow(1.0 - t, 1.2) * streaks * behind;

  // Dust tail: broader, bends a little to one side and fades sooner.
  float bend = headWidth * 1.5 * t * t;
  float dustAcross = (vLocal.y - bend) / width;
  float dust = exp(-dustAcross * dustAcross * 3.0) * pow(1.0 - t, 2.0) * behind;

  // Coma: a soft glow around the nucleus.
  float r = length(vLocal) / coma;
  float glow = exp(-r * r * 3.0) * (1.0 - smoothstep(0.6, 1.0, r));

  // Fade the tail in where it leaves the coma so there is no seam at the nucleus.
  float root = smoothstep(0.0, coma * 0.6, vLocal.x);
  vec3 colour = uIonColor * ion * 0.9 * root + uDustColor * dust * 0.5 * root + mix(uDustColor, vec3(1.0), 0.5) * glow * 0.8;
  // Nothing may reach the quad's edges, or its outline shows.
  float edges = (1.0 - smoothstep(0.75, 1.0, abs(vQuad.y))) * (1.0 - smoothstep(0.85, 1.0, vQuad.x));
  gl_FragColor = vec4(colour * fade * edges, 0.0);
}
