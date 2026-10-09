// Replaces three's <project_vertex>: instance transform to world space, tidal stretch, then view
// and projection.
vec4 mvPosition = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  mvPosition = modelMatrix * instanceMatrix * mvPosition;
  vec3 instanceCentre = (modelMatrix * instanceMatrix[3]).xyz;
  mvPosition.xyz = spaghettify(instanceCentre, mvPosition.xyz);
  #ifndef FLAT_SHADED
    // The model matrix is identity, so the view-space normal goes back to world space with the
    // transpose of the view rotation.
    vec3 worldNormal = (vec4(transformedNormal, 0.0) * viewMatrix).xyz;
    vNormal = normalize((viewMatrix * vec4(spaghettifyNormal(worldNormal), 0.0)).xyz);
  #endif
  mvPosition = viewMatrix * mvPosition;
#else
  vGlow = 0.0;
  vHeat = 0.0;
  mvPosition = modelViewMatrix * mvPosition;
#endif
gl_Position = projectionMatrix * mvPosition;
