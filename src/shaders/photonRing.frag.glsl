// Thin bright ring hugging the shadow of the hole: disk light that orbited the photon sphere.
// It gives the black core a crisp, defined edge.
uniform float uRadius;
uniform float uWidth;
uniform vec3 uColor;
uniform float uIntensity;

varying vec2 vPos;

void main() {
  float d = length(vPos);
  float k = (d - uRadius) / uWidth;
  // Sharp on the inside so the core edge stays crisp, a softer tail outside.
  float ring = d < uRadius ? exp(-k * k * 16.0) : exp(-k * k);
  ring *= step(1.0, d);
  gl_FragColor = vec4(uColor * uIntensity * ring, ring);
}
