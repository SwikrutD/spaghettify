// Approximate colour of a blackbody at the given temperature in kelvin, in linear RGB with the
// brightest channel at 1. Curve fit by Tanner Helland (valid 1000 K to 40000 K), converted from sRGB.
vec3 blackbody(float kelvin) {
  float t = clamp(kelvin, 1000.0, 40000.0) / 100.0;
  vec3 c;
  if (t <= 66.0) {
    c.r = 1.0;
    c.g = 0.39008157876901960784 * log(t) - 0.63184144378862745098;
  } else {
    c.r = 1.29293618606274509804 * pow(t - 60.0, -0.1332047592);
    c.g = 1.12989086089529411765 * pow(t - 60.0, -0.0755148492);
  }
  if (t >= 66.0) {
    c.b = 1.0;
  } else if (t <= 19.0) {
    c.b = 0.0;
  } else {
    c.b = 0.54320678911019607843 * log(t - 10.0) - 1.19625408914;
  }
  return pow(clamp(c, 0.0, 1.0), vec3(2.2));
}
