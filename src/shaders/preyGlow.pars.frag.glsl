// Tidal heating glow for prey falling into the hole. Injected after three's <common> chunk.
uniform vec3 uGlowColor;
varying float vGlow;
// Heat of the body itself (shed debris): glows from hot to dull red as it cools.
uniform vec3 uHeatHot;
uniform vec3 uHeatCool;
varying float vHeat;
