// Procedural surfaces of the round bodies (planets and moons). Injected after three's <common> chunk in the smooth
// prey material (src/entities/preyMaterial.ts); preySurface.frag.glsl applies it after <color_fragment>. The pattern
// is a function of the point on the body's own unit sphere (vSurfPos, before the instance transform), so it turns
// with the body's spin and stretches with it when it spaghettifies. Albedo only: the key light does the shading.
//
// vSurface.x is the kind (SURFACE.kinds in src/config): 1 icy dwarf planet, 2 moon, 3 rocky planet, 4 ice giant,
// 5 gas giant, anything else plain. vSurface.y (0..1) varies the look per body. +y is the body's pole.

#include lib/simplex3d.glsl

varying vec3 vSurfPos;
varying vec2 vSurface;

// Sphere units per pixel here (set once per fragment): detail finer than a pixel or two fades out instead of shimmering.
float surfPixel = 0.0;

// Fade for a pattern of `freq` features per sphere unit: 1 when they are several pixels wide, 0 under a pixel.
float surfDetail(float freq) {
  return 1.0 - smoothstep(0.12, 0.35, surfPixel * freq);
}

float surfFbm(vec3 p, float freq) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * snoise(p * freq) * surfDetail(freq);
    freq *= 2.03;
    p += 1.7;
    a *= 0.5;
  }
  return s;
}

vec4 surfHash4(vec3 p) {
  vec4 q = fract(p.xyzx * vec4(0.1031, 0.1030, 0.0973, 0.1099));
  q += dot(q, q.wzxy + 33.33);
  return fract((q.xxyz + q.yzzw) * q.zywx);
}

// Craters of one size: up to one per cell of a 3D grid (`scale` cells per sphere unit; `density` the share of cells
// that have one) with a radius under half a cell, so only the 8 nearest cells can reach a point. The sphere cuts
// each crater ball into a disc. About -0.3 on a crater floor, +0.25 on its rim, 0 elsewhere.
float surfCraters(vec3 p, float scale, float density, float seed) {
  vec3 q = p * scale + seed * 37.0;
  vec3 base = floor(q - 0.5);
  float shade = 0.0;
  for (int z = 0; z < 2; z++) {
    for (int y = 0; y < 2; y++) {
      for (int x = 0; x < 2; x++) {
        vec3 cell = base + vec3(float(x), float(y), float(z));
        vec4 h = surfHash4(cell);
        if (h.w > density) continue;
        vec4 g = surfHash4(cell + 19.19);
        float r = mix(0.2, 0.5, g.x * g.x);
        float d = length(q - (cell + h.xyz)) / r;
        if (d > 1.4) continue;
        shade += -0.3 * (1.0 - smoothstep(0.55, 1.0, d)) + 0.25 * exp(-(d - 1.0) * (d - 1.0) * 30.0);
      }
    }
  }
  return shade * surfDetail(scale);
}

// An oval spot centred on the sphere at `c` (unit), `w` wide along the latitude line and `h` tall: 1 inside, 0 out.
float surfSpot(vec3 p, vec3 c, float w, float h) {
  vec3 east = normalize(vec3(-c.z, 0.0, c.x));
  vec3 v = p - c;
  float e = length(vec2(dot(v, east) / w, v.y / h));
  return 1.0 - smoothstep(0.7, 1.0, e);
}

vec3 preySurface(vec3 base) {
  float kind = vSurface.x;
  if (kind < 0.5) return base;
  vec3 p = normalize(vSurfPos);
  surfPixel = length(fwidth(vSurfPos));
  float seed = vSurface.y;
  float lat = p.y;

  if (kind < 1.5) {
    // Icy dwarf planet: bright ice and dark plains (reddish on some, grey on others), a scatter of craters.
    float plains = smoothstep(-0.05, 0.3, surfFbm(p + seed * 13.0, 1.6));
    vec3 dark = base * mix(vec3(0.62), vec3(0.85, 0.6, 0.45), seed);
    vec3 albedo = mix(base * 1.12, dark, plains * 0.85);
    return albedo * (1.0 + 0.8 * surfCraters(p, 8.0, 0.55, seed) + 0.5 * surfCraters(p, 21.0, 0.5, seed + 3.0));
  }
  if (kind < 2.5) {
    // Moon: dark maria on bright highlands, craters of two sizes (softer on the maria), fine regolith grain.
    float maria = smoothstep(0.05, 0.32, surfFbm(p + seed * 11.0, 1.3));
    vec3 albedo = base * mix(1.1, 0.62, maria);
    float craters = surfCraters(p, 6.0, 0.7, seed) + 0.7 * surfCraters(p, 17.0, 0.65, seed + 5.0);
    albedo *= 1.0 + craters * mix(1.0, 0.55, maria);
    return albedo * (1.0 + 0.07 * snoise(p * 45.0) * surfDetail(45.0));
  }
  if (kind < 3.5) {
    // Rocky planet: light uplands and dark lowlands, finer terrain, faint craters, ice caps on most.
    float low = smoothstep(-0.15, 0.25, surfFbm(p + seed * 7.0, 2.0));
    vec3 albedo = base * mix(1.15, 0.68, low);
    albedo *= 1.0 + 0.12 * snoise(p * 9.0 + seed * 3.0) * surfDetail(9.0) + 0.4 * surfCraters(p, 9.0, 0.35, seed);
    float cap = smoothstep(0.84, 0.9, abs(lat) + 0.06 * snoise(p * 5.0 + seed)) * step(0.25, seed);
    return mix(albedo, vec3(0.86, 0.87, 0.9), cap);
  }
  if (kind < 4.5) {
    // Ice giant: soft bands, brighter haze toward the poles, a dark spot on some.
    float wobble = snoise(vec3(p.x * 2.0, p.y * 6.0, p.z * 2.0) + seed * 5.0);
    float bands = sin(lat * 11.0 + wobble * 0.8 + seed * 6.283);
    vec3 albedo = base * (1.0 + 0.07 * bands * surfDetail(4.0)) * (1.0 + 0.12 * smoothstep(0.6, 0.95, abs(lat)));
    vec3 c = normalize(vec3(cos(seed * 40.0), mix(-0.45, 0.2, fract(seed * 7.0)), sin(seed * 40.0)));
    return albedo * (1.0 - 0.35 * surfSpot(p, c, 0.2, 0.1) * step(0.5, seed));
  }
  if (kind < 5.5) {
    // Gas giant: light zones and darker belts, warped by turbulence, fine banding, and a storm oval on most.
    float warp = surfFbm(vec3(p.x * 0.28, p.y, p.z * 0.28) + seed * 9.0, 9.0);
    float b1 = sin(lat * 15.0 + warp * 1.6 + seed * 6.283);
    float b2 = sin(lat * 37.0 + warp * 2.5) * surfDetail(12.0);
    float belt = smoothstep(-0.2, 0.6, b1) * surfDetail(5.0);
    vec3 albedo = base * mix(vec3(1.15, 1.1, 1.02), vec3(0.78, 0.6, 0.46), belt) * (1.0 + 0.06 * b2);
    vec3 c = normalize(vec3(cos(seed * 31.0), -0.38, sin(seed * 31.0)));
    float storm = surfSpot(p, c, 0.17, 0.085) * step(0.3, seed);
    return mix(albedo, base * vec3(1.15, 0.62, 0.45), storm * 0.85);
  }
  return base;
}
