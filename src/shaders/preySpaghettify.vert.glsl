// Replaces three's <project_vertex>: instance transform to world space, tidal stretch, then view
// and projection.
vec4 mvPosition = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  mvPosition = modelMatrix * instanceMatrix * mvPosition;
  vec3 instanceCentre = (modelMatrix * instanceMatrix[3]).xyz;
  mvPosition.xyz = spaghettify(instanceCentre, mvPosition.xyz);
  mvPosition = viewMatrix * mvPosition;
#else
  vGlow = 0.0;
  mvPosition = modelViewMatrix * mvPosition;
#endif
gl_Position = projectionMatrix * mvPosition;
