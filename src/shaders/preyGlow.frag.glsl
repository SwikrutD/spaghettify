// Injected after three's <emissivemap_fragment>. HDR, so the hottest parts catch the bloom.
// Emission only: alpha stays 1, which the lensing pass reads as its play-plane mask.
totalEmissiveRadiance += uGlowColor * vGlow;
totalEmissiveRadiance += mix(uHeatCool, uHeatHot, vHeat) * vHeat;
