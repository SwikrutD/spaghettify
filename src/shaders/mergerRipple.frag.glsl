// Gravitational wave ripple of a merger: a bright ring spreading out from the eater with a fainter one trailing
// it, both thinning and fading as they go. uAge runs 0..1 over the ripple's life; vPos is in quad half-widths.
uniform float uAge;
uniform float uWidth;
uniform vec3 uColor;

varying vec2 vPos;

void main() {
  float d = length(vPos);
  float w = uWidth * (0.7 + uAge);
  float lead = exp(-pow((d - uAge) / w, 2.0));
  float trail = 0.5 * exp(-pow((d - uAge * 0.7) / (w * 1.4), 2.0));
  float fade = (1.0 - uAge) * (1.0 - uAge);
  float edge = 1.0 - smoothstep(0.8, 1.0, d);
  float rise = smoothstep(0.0, 0.08, uAge);
  gl_FragColor = vec4(uColor * (lead + trail) * fade * edge * rise, 1.0);
}
