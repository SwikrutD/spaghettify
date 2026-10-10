import type * as THREE from 'three';
import { DEBRIS } from '../config';
import { PreyMesh, type BodyFrame } from './PreyMesh';

/** Debris fragments as drawn: glowing rocks (one rock PreyMesh, one draw call) that cool as they age. */
export class DebrisMesh {
  private readonly mesh = new PreyMesh(DEBRIS.poolSize);

  /** The instanced mesh; add it to the scene. */
  get object3d(): THREE.InstancedMesh {
    return this.mesh.mesh;
  }

  update(frame: BodyFrame): void {
    this.mesh.begin();
    for (const frag of frame.world.debris.objects) if (frag.active) this.mesh.add(frag, frame, frag.heat);
    this.mesh.end();
  }
}
