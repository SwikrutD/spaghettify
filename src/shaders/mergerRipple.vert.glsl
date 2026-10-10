// A flat quad lying on the play plane, centred on the eater. vPos runs -1..1 across it.
varying vec2 vPos;

void main() {
  vPos = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
