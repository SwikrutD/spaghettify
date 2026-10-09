import { LENSING } from '../config';

/**
 * Lens settings shared (same uniform objects) by the lensing post pass and the accretion disk,
 * which bends itself in its vertex shader. Changing a value here changes both.
 */
export const lensUniforms = {
  uLensOn: { value: 1 },
  uLensEinstein: { value: LENSING.einsteinRadius as number },
  uLensPlaneEinstein: { value: LENSING.planeEinsteinRadius as number },
  uLensFalloff: { value: LENSING.falloff as number },
  uLensRadius: { value: LENSING.radius as number },
  uLensDepthRange: { value: LENSING.planeDepthRange as number },
  uLensDepthSoft: { value: LENSING.planeDepthSoft as number },
};
