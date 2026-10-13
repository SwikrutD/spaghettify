// The round bodies' surface (see preySurface.pars.frag.glsl). Injected after three's <common> chunk.
// Per instance: x the surface kind, y a 0..1 variation.
attribute vec2 aSurface;
varying vec3 vSurfPos;
varying vec2 vSurface;
