import * as THREE from 'three';
import { DISK, PHOTON_RING, QUALITY } from '../config';
import { OVERLAY_LAYER } from '../render/layers';
import { lensUniforms } from '../render/lensUniforms';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import diskVert from '../shaders/accretionDisk.vert.glsl';
import diskFrag from '../shaders/accretionDisk.frag.glsl';
import fullscreenVert from '../shaders/fullscreen.vert.glsl';
import turbulenceFrag from '../shaders/diskTurbulence.frag.glsl';
import ringVert from '../shaders/photonRing.vert.glsl';
import ringFrag from '../shaders/photonRing.frag.glsl';

const tmpColor = new THREE.Color();
/** Loop bound for the disk's noise octaves (the live count is a uniform). */
const MAX_OCTAVES = 3;

/** Number uniform; widens `as const` config literals to number. */
const num = (value: number): { value: number } => ({ value });

/**
 * Accretion disk plus photon ring. Lives inside the player group, so local units are player radii.
 * Brightness, temperature, width and thickness follow `heat`, a 0..1 feeding level driven by
 * long-term growth and recent meals (see DISK in config).
 */
export class AccretionDisk {
  readonly group = new THREE.Group();
  /** Displayed 0..1 feeding level. */
  heat = 0;
  /** Recent accretion rate. Jumps on each meal, decays over time. */
  activity = 0;
  /** 0..1 hunger level; dims the disk and ring (Hawking evaporation). */
  starvation = 0;
  private time = 0;
  private layers: number = QUALITY.levels[0].diskLayers;
  private readonly disk: THREE.Mesh;
  private readonly diskUniforms;
  private readonly ringUniforms;
  /** Turbulence polar map (one channel per layer), rendered once per frame by prepare(). */
  private readonly turbUniforms;
  private readonly turbTarget: THREE.WebGLRenderTarget;
  private readonly turbQuad: FullScreenQuad;

  constructor() {
    const logRange = new THREE.Vector2(Math.log(DISK.innerRadius), Math.log(DISK.outerRadiusMax));
    this.turbTarget = new THREE.WebGLRenderTarget(DISK.turbulenceWidth, DISK.turbulenceHeight, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      generateMipmaps: false,
    });
    this.turbUniforms = {
      uTime: num(0),
      uInner: num(DISK.innerRadius),
      uSpin: num(DISK.spin),
      uOmegaInner: num(DISK.innerAngularSpeed),
      uFlowPeriod: num(DISK.flowPeriod),
      uNoiseRadialFreq: num(DISK.noiseRadialFreq),
      uNoiseAngularFreq: num(DISK.noiseAngularFreq),
      uSpiralTwist: num(DISK.spiralTwist),
      uLogRange: { value: logRange },
      uOctaves: num(QUALITY.levels[0].diskOctaves),
      uLayers: num(this.layers),
      uLayerHeights: { value: layerHeights(this.layers) },
    };
    this.turbQuad = new FullScreenQuad(
      new THREE.ShaderMaterial({
        vertexShader: fullscreenVert,
        fragmentShader: turbulenceFrag,
        uniforms: this.turbUniforms,
        defines: { MAX_OCTAVES },
        depthTest: false,
        depthWrite: false,
        blending: THREE.NoBlending,
      }),
    );

    this.diskUniforms = {
      uInner: num(DISK.innerRadius),
      uOuter: num(DISK.outerRadiusMin),
      uThickness: num(DISK.thicknessMin),
      uCamLocal: { value: new THREE.Vector3(0, -10, 10) },
      uSpin: num(DISK.spin),
      uBeta: num(DISK.dopplerBeta),
      uBeamingPower: num(DISK.beamingPower),
      uTorque: num(DISK.innerTorque),
      uProfilePeak: num(temperatureProfilePeak(DISK.innerTorque)),
      uPeakKelvin: num(DISK.peakKelvinMin),
      uTempIntensityPower: num(DISK.tempIntensityPower),
      uBrightness: num(DISK.brightnessMin),
      uContrast: num(DISK.contrast),
      uSaturation: num(DISK.colorSaturation),
      uOuterSoftness: num(DISK.outerSoftness),
      uLayerFalloff: num(DISK.layerFalloff),
      uLayerNorm: num(layerNorm(this.layers, DISK.layerFalloff)),
      tTurbulence: { value: this.turbTarget.texture },
      uTurbLogRange: { value: logRange },
      // The disk is drawn over the lensed image and bends itself (see lensVertex.glsl).
      ...lensUniforms,
    };
    const disk = new THREE.Mesh(
      createLayeredRing(this.layers),
      new THREE.ShaderMaterial({
        vertexShader: diskVert,
        fragmentShader: diskFrag,
        uniforms: this.diskUniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    // Ring geometry is built in XY; lay it flat on the play plane (local +Z becomes world up).
    disk.rotation.x = -Math.PI / 2;
    // The vertex shader resizes the ring, so the geometry bounds are meaningless.
    disk.frustumCulled = false;
    // Doppler beaming needs the camera position in the disk's local frame.
    disk.onBeforeRender = (_renderer, _scene, camera) => {
      const cam = this.diskUniforms.uCamLocal.value;
      cam.setFromMatrixPosition(camera.matrixWorld);
      disk.worldToLocal(cam);
    };

    const ringExtent = PHOTON_RING.radius + PHOTON_RING.width * 4;
    this.ringUniforms = {
      uExtent: num(ringExtent),
      uRadius: num(PHOTON_RING.radius),
      uWidth: num(PHOTON_RING.width),
      uColor: { value: new THREE.Color() },
      uIntensity: num(PHOTON_RING.intensityMin),
    };
    const ring = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        vertexShader: ringVert,
        fragmentShader: ringFrag,
        uniforms: this.ringUniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    ring.frustumCulled = false;

    // Drawn on top of the lensed scene by LensingPass rather than bent by it (the disk bends itself).
    disk.layers.set(OVERLAY_LAYER);
    ring.layers.set(OVERLAY_LAYER);

    this.disk = disk;
    this.group.add(disk, ring);
    this.applyHeat();
  }

  /** Quality level: stacked layers (1 to 3, each costs one disk of fill rate) and noise octaves (1 to MAX_OCTAVES). */
  setDetail(layers: number, octaves: number): void {
    this.turbUniforms.uOctaves.value = THREE.MathUtils.clamp(Math.round(octaves), 1, MAX_OCTAVES);
    layers = THREE.MathUtils.clamp(Math.round(layers), 1, 3);
    if (layers === this.layers) return;
    this.layers = layers;
    this.disk.geometry.dispose();
    this.disk.geometry = createLayeredRing(layers);
    this.diskUniforms.uLayerNorm.value = layerNorm(layers, DISK.layerFalloff);
    this.turbUniforms.uLayers.value = layers;
    this.turbUniforms.uLayerHeights.value = layerHeights(layers);
  }

  /** Size the turbulence map for a render this many pixels high (the disk's size on screen follows the height). */
  setRenderHeight(pixels: number): void {
    const scale = Math.min(1, pixels / DISK.turbulenceRefHeight);
    const width = Math.max(DISK.turbulenceMinWidth, Math.round(DISK.turbulenceWidth * scale));
    const height = Math.round((width * DISK.turbulenceHeight) / DISK.turbulenceWidth);
    if (width !== this.turbTarget.width || height !== this.turbTarget.height) this.turbTarget.setSize(width, height);
  }

  /** Render this frame's turbulence map. Call before the scene is rendered. */
  prepare(renderer: THREE.WebGLRenderer): void {
    this.turbUniforms.uTime.value = this.time;
    const target = renderer.getRenderTarget();
    renderer.setRenderTarget(this.turbTarget);
    this.turbQuad.render(renderer);
    renderer.setRenderTarget(target);
  }

  /** Record a meal. `massFraction` is the gained mass divided by the player's mass after eating. */
  feed(massFraction: number): void {
    this.activity += massFraction * DISK.feedGain;
  }

  reset(): void {
    this.heat = 0;
    this.activity = 0;
    this.starvation = 0;
    this.applyHeat();
  }

  /** `growthRatio` is eatenMass / startMass. */
  update(dt: number, growthRatio: number): void {
    this.time += dt;
    this.activity *= Math.exp(-DISK.feedDecay * dt);

    const growth = THREE.MathUtils.clamp(Math.log1p(growthRatio) / Math.log(DISK.growthFullMassRatio), 0, 1);
    const target = THREE.MathUtils.clamp(
      DISK.growthWeight * growth + DISK.activityWeight * (1 - Math.exp(-this.activity)),
      0,
      1,
    );
    const rate = target > this.heat ? DISK.heatRise : DISK.heatFall;
    this.heat += (target - this.heat) * (1 - Math.exp(-rate * dt));
    this.applyHeat();
  }

  private applyHeat(): void {
    const h = this.heat;
    const lerp = THREE.MathUtils.lerp;
    const u = this.diskUniforms;
    u.uOuter.value = lerp(DISK.outerRadiusMin, DISK.outerRadiusMax, h);
    u.uThickness.value = lerp(DISK.thicknessMin, DISK.thicknessMax, h);
    u.uPeakKelvin.value = lerp(DISK.peakKelvinMin, DISK.peakKelvinMax, h);
    const dim = 1 - DISK.starveDim * this.starvation;
    u.uBrightness.value = lerp(DISK.brightnessMin, DISK.brightnessMax, h) * dim;

    this.ringUniforms.uIntensity.value = lerp(PHOTON_RING.intensityMin, PHOTON_RING.intensityMax, h) * dim;
    this.ringUniforms.uColor.value.copy(blackbodyColor(u.uPeakKelvin.value * PHOTON_RING.kelvinFactor, tmpColor));
  }
}

/**
 * Height of layer l of `layers` in -1..1. Three layers sit at -1, 0, 1; fewer layers stay nearer the
 * midplane (two at -0.5 and 0.5, one at 0) so a lower quality level keeps the same overall look.
 */
function layerHeight(l: number, layers: number): number {
  return layers === 1 ? 0 : ((l / (layers - 1)) * 2 - 1) * Math.min(1, (layers - 1) / 2);
}

/** Heights of up to three layers, one per turbulence map channel. */
function layerHeights(layers: number): THREE.Vector3 {
  return new THREE.Vector3(layerHeight(0, layers), layerHeight(1, layers), layerHeight(2, layers));
}

/** 1 / sum of layer weights, so the layer count changes volume but not total brightness. */
function layerNorm(layers: number, falloff: number): number {
  let sum = 0;
  for (let l = 0; l < layers; l++) {
    const layer = layerHeight(l, layers);
    sum += Math.exp(-falloff * layer * layer);
  }
  return 1 / sum;
}

/** Peak of x^0.75 * (1 - k * sqrt(x))^0.25 over the disk (x = rInner / r in 0..1), used to normalise the profile. */
function temperatureProfilePeak(k: number): number {
  let peak = 0;
  for (let i = 1; i <= 400; i++) {
    const x = i / 400;
    peak = Math.max(peak, Math.pow(x, 0.75) * Math.pow(Math.max(1 - k * Math.sqrt(x), 0), 0.25));
  }
  return peak;
}

/** CPU twin of blackbody() in lib/blackbody.glsl (linear RGB, brightest channel 1). */
function blackbodyColor(kelvin: number, out: THREE.Color): THREE.Color {
  const t = THREE.MathUtils.clamp(kelvin, 1000, 40000) / 100;
  let r: number;
  let g: number;
  let b: number;
  if (t <= 66) {
    r = 1;
    g = 0.3900815788 * Math.log(t) - 0.6318414438;
  } else {
    r = 1.2929361861 * Math.pow(t - 60, -0.1332047592);
    g = 1.1298908609 * Math.pow(t - 60, -0.0755148492);
  }
  if (t >= 66) b = 1;
  else if (t <= 19) b = 0;
  else b = 0.5432067891 * Math.log(t - 10) - 1.19625408914;
  const lin = (c: number) => Math.pow(THREE.MathUtils.clamp(c, 0, 1), 2.2);
  return out.setRGB(lin(r), lin(g), lin(b));
}

/** Ring from radius 1 to 2 in XY, stacked `layers` times with an aLayer height in -1..1 and the layer index as aChannel. */
function createLayeredRing(layers: number): THREE.BufferGeometry {
  const base = new THREE.RingGeometry(1, 2, DISK.thetaSegments, DISK.radialSegments);
  const basePos = base.getAttribute('position');
  const baseIndex = base.getIndex();
  if (!baseIndex) throw new Error('RingGeometry is expected to be indexed');
  const vCount = basePos.count;
  const positions = new Float32Array(vCount * 3 * layers);
  const layerAttr = new Float32Array(vCount * layers);
  const channelAttr = new Float32Array(vCount * layers);
  const indices: number[] = [];
  for (let l = 0; l < layers; l++) {
    const layer = layerHeight(l, layers);
    positions.set(basePos.array as Float32Array, l * vCount * 3);
    layerAttr.fill(layer, l * vCount, (l + 1) * vCount);
    channelAttr.fill(l, l * vCount, (l + 1) * vCount);
    for (let i = 0; i < baseIndex.count; i++) indices.push(baseIndex.getX(i) + l * vCount);
  }
  base.dispose();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aLayer', new THREE.BufferAttribute(layerAttr, 1));
  geo.setAttribute('aChannel', new THREE.BufferAttribute(channelAttr, 1));
  geo.setIndex(indices);
  return geo;
}
