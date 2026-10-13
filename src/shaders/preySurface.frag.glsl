// Injected after three's <color_fragment> (the instance colour is in diffuseColor by then): the round body's
// surface pattern, see preySurface.pars.frag.glsl.
diffuseColor.rgb = preySurface(diffuseColor.rgb);
