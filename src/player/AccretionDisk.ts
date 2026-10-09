import * as THREE from 'three';
import { DISK, PHOTON_RING } from '../config';
import diskVert from '../shaders/accretionDisk.vert.glsl';
import diskFrag from '../shaders/accretionDisk.frag.glsl';
import ringVert from '../shaders/photonRing.vert.glsl';
import ringFrag from '../shaders/photonRing.frag.glsl';

const tmpColor = new THREE.Color();

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
  private time = 0;
  private readonly diskUniforms;
  private readonly ringUniforms;

  constructor() {
    this.diskUniforms = {
      uTime: num(0),
      uInner: num(DISK.innerRadius),
      uOuter: num(DISK.outerRadiusMin),
      uThickness: num(DISK.thicknessMin),
      uCamLocal: { value: new THREE.Vector3(0, -10, 10) },
      uSpin: num(DISK.spin),
      uOmegaInner: num(DISK.innerAngularSpeed),
      uFlowPeriod: num(DISK.flowPeriod),
      uBeta: num(DISK.dopplerBeta),
      uBeamingPower: num(DISK.beamingPower),
      uTorque: num(DISK.innerTorque),
      uProfilePeak: num(temperatureProfilePeak(DISK.innerTorque)),
      uPeakKelvin: num(DISK.peakKelvinMin),
      uTempIntensityPower: num(DISK.tempIntensityPower),
      uBrightness: num(DISK.brightnessMin),
      uNoiseRadialFreq: num(DISK.noiseRadialFreq),
      uNoiseAngularFreq: num(DISK.noiseAngularFreq),
      uSpiralTwist: num(DISK.spiralTwist),
      uContrast: num(DISK.contrast),
      uSaturation: num(DISK.colorSaturation),
      uOuterSoftness: num(DISK.outerSoftness),
      uLayerFalloff: num(DISK.layerFalloff),
      uLayerNorm: num(layerNorm(DISK.layers, DISK.layerFalloff)),
    };
    const disk = new THREE.Mesh(
      createLayeredRing(DISK.layers),
      new THREE.ShaderMaterial({
        vertexShader: diskVert,
        fragmentShader: diskFrag,
        uniforms: this.diskUniforms,
        defines: { NOISE_OCTAVES: DISK.noiseOctaves },
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

    this.group.add(disk, ring);
    this.applyHeat();
  }

  /** Record a meal. `massFraction` is the gained mass divided by the player's mass after eating. */
  feed(massFraction: number): void {
    this.activity += massFraction * DISK.feedGain;
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
    u.uTime.value = this.time;
    u.uOuter.value = lerp(DISK.outerRadiusMin, DISK.outerRadiusMax, h);
    u.uThickness.value = lerp(DISK.thicknessMin, DISK.thicknessMax, h);
    u.uPeakKelvin.value = lerp(DISK.peakKelvinMin, DISK.peakKelvinMax, h);
    u.uBrightness.value = lerp(DISK.brightnessMin, DISK.brightnessMax, h);

    this.ringUniforms.uIntensity.value = lerp(PHOTON_RING.intensityMin, PHOTON_RING.intensityMax, h);
    this.ringUniforms.uColor.value.copy(blackbodyColor(u.uPeakKelvin.value * PHOTON_RING.kelvinFactor, tmpColor));
  }
}

/** 1 / sum of layer weights, so the layer count changes volume but not total brightness. */
function layerNorm(layers: number, falloff: number): number {
  let sum = 0;
  for (let l = 0; l < layers; l++) {
    const layer = layers === 1 ? 0 : (l / (layers - 1)) * 2 - 1;
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

/** Ring from radius 1 to 2 in XY, stacked `layers` times with an aLayer attribute in -1..1. */
function createLayeredRing(layers: number): THREE.BufferGeometry {
  const base = new THREE.RingGeometry(1, 2, DISK.thetaSegments, DISK.radialSegments);
  const basePos = base.getAttribute('position');
  const baseIndex = base.getIndex();
  if (!baseIndex) throw new Error('RingGeometry is expected to be indexed');
  const vCount = basePos.count;
  const positions = new Float32Array(vCount * 3 * layers);
  const layerAttr = new Float32Array(vCount * layers);
  const indices: number[] = [];
  for (let l = 0; l < layers; l++) {
    const layer = layers === 1 ? 0 : (l / (layers - 1)) * 2 - 1;
    positions.set(basePos.array as Float32Array, l * vCount * 3);
    layerAttr.fill(layer, l * vCount, (l + 1) * vCount);
    for (let i = 0; i < baseIndex.count; i++) indices.push(baseIndex.getX(i) + l * vCount);
  }
  base.dispose();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aLayer', new THREE.BufferAttribute(layerAttr, 1));
  geo.setIndex(indices);
  return geo;
}
