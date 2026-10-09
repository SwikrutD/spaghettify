// Camera-facing quad centred on the black hole. vPos is in core radii.
uniform float uExtent;

varying vec2 vPos;

void main() {
  vPos = position.xy * uExtent;
  float worldScale = length(modelMatrix[0].xyz);
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += vPos * worldScale;
  gl_Position = projectionMatrix * mv;
}
