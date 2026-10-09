// Spaghettification for the prey InstancedMesh. Injected into MeshStandardMaterial (see
// src/entities/preyMaterial.ts): declarations go after three's <common> chunk, and
// preySpaghettify.vert.glsl replaces <project_vertex>.
//
// Each instance is stretched in world space along the line to the hole and squeezed across it,
// then wound into a spiral around the hole. Flat shading (the rocks) takes normals from screen
// derivatives of the final position, so the lighting follows the stretched shape for free. Smooth
// shading (the round bodies) bends the vertex normal with spaghettifyNormal() instead.

// xy: unit direction from the hole to the object on the play plane (world XZ).
// z: stretch factor along it (1 = none). w: curl, radians of lead per e-fold of distance to the hole.
attribute vec4 aStretch;
// Tidal heating glow, 0..1.
attribute float aGlow;

// Hole centre (world x, z) and core radius.
uniform vec3 uHole;
// Across-axis scale = stretch ^ -uSqueeze (0.5 preserves volume).
uniform float uSqueeze;
// Radial distances below uKnee core radii are squashed toward the centre.
uniform float uKnee;
// Parts within uGlowReach core radii of the hole glow.
uniform float uGlowReach;

varying float vGlow;

// Curl angle of the current vertex, left by spaghettify() for spaghettifyNormal().
float spgPhi = 0.0;

vec3 spaghettify(vec3 centre, vec3 p) {
  vec3 u = vec3(aStretch.x, 0.0, aStretch.y);
  float s = aStretch.z;
  vec3 d = p - centre;
  float along = dot(d, u);
  vec3 across = d - along * u;

  // Radial distance from the hole after stretching. Below the knee it is squashed smoothly (C1)
  // toward zero, so a stream reaching the centre bunches up inside the core instead of
  // coming out the other side.
  float rc = length(centre.xz - uHole.xy);
  float r = rc + along * s;
  float knee = max(uKnee * uHole.z, 1e-4);
  if (r < knee) r = knee * exp((r - knee) / knee);

  vec3 q = centre + u * (r - rc) + across * pow(s, -uSqueeze);

  // Differential rotation: the end nearer the hole leads, the far end trails.
  float phi = clamp(aStretch.w * log(max(rc, 1e-4) / r), -3.0, 3.0);
  spgPhi = phi;
  vec2 o = q.xz - uHole.xy;
  float c = cos(phi);
  float sn = sin(phi);
  q.xz = uHole.xy + vec2(o.x * c + o.y * sn, -o.x * sn + o.y * c);

  vGlow = aGlow * (1.0 - smoothstep(1.0, uGlowReach, r / uHole.z));
  return q;
}

// World-space normal of the stretched surface: the inverse transpose of the stretch and squeeze, then
// the same curl rotation as the vertex. Ignores the knee squash, which only acts inside the core.
vec3 spaghettifyNormal(vec3 n) {
  vec3 u = vec3(aStretch.x, 0.0, aStretch.y);
  float s = aStretch.z;
  float along = dot(n, u);
  n = u * (along / s) + (n - along * u) * pow(s, uSqueeze);
  float c = cos(spgPhi);
  float sn = sin(spgPhi);
  n.xz = vec2(n.x * c + n.z * sn, -n.x * sn + n.z * c);
  return normalize(n);
}
