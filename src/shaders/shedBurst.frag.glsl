// Hot disk matter that reddens and fades as it cools. HDR, additive, leaves alpha alone.
uniform vec3 uColor;
varying float vLife;

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float a = smoothstep(1.0, 0.0, d);
  vec3 cool = vec3(uColor.r, uColor.g * 0.3, uColor.b * 0.1);
  vec3 colour = mix(cool, uColor, vLife) * vLife * a;
  gl_FragColor = vec4(colour, 0.0);
}
