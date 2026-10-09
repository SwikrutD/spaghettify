import * as THREE from 'three';
import { CAMERA } from '../config';

/** Tilted 2.5D follow camera. Distance scales with the target radius. */
export class GameCamera {
  readonly camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far);
  private readonly focus = new THREE.Vector3();
  private readonly offsetDir: THREE.Vector3;
  private distance: number;

  constructor(target: THREE.Vector3, radius: number) {
    const tilt = THREE.MathUtils.degToRad(CAMERA.tiltDegrees);
    // Camera sits behind (+Z) and above the focus, looking toward -Z and down.
    this.offsetDir = new THREE.Vector3(0, Math.sin(tilt), Math.cos(tilt));
    this.distance = radius * CAMERA.distancePerRadius;
    this.focus.copy(target);
    this.place();
  }

  update(dt: number, target: THREE.Vector3, radius: number): void {
    const k = 1 - Math.exp(-CAMERA.followSmoothing * dt);
    this.focus.lerp(target, k);
    this.distance += (radius * CAMERA.distancePerRadius - this.distance) * k;
    this.place();
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private place(): void {
    this.camera.position.copy(this.focus).addScaledVector(this.offsetDir, this.distance);
    this.camera.lookAt(this.focus);
  }
}
