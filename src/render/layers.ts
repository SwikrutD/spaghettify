/**
 * Camera layers. Layer 0 is the ordinary scene, which the lensing pass bends.
 * The hole's own parts are kept off layer 0 and drawn on top of the bent image instead.
 */

/** The black core. Drawn after lensing (never bent) and again after bloom so the shadow stays crisp. */
export const CORE_LAYER = 1;

/** Drawn after lensing on top of the bent image: the accretion disk (which bends itself, see lensVertex.glsl) and the photon ring. */
export const OVERLAY_LAYER = 2;
