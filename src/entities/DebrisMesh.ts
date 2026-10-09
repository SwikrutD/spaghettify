import type * as THREE from 'three';
import { DEBRIS } from '../config';
import type { DebrisField } from '../sim/DebrisField.ts';
import { PreyMesh, type BodyFrame } from './PreyMesh';

/** Debris fragments as drawn: glowing rocks (one rock PreyMesh, one draw call) that cool as they age. */
export class DebrisMesh {
  private readonly mesh = new PreyMesh(DEBRIS.poolSize);
  private readonly field: DebrisField;

  constructor(field: DebrisField) {
    this.field = field;
    this.mesh.mesh.count = DEBRIS.poolSize;
  }

  /** The instanced mesh; add it to the scene. */
  get object3d(): THREE.InstancedMesh {
    return this.mesh.mesh;
  }

  update(frame: BodyFrame): void {
    this.mesh.setHole(frame);
    const objects = this.field.objects;
    for (let i = 0; i < objects.length; i++) {
      const frag = objects[i];
      if (!frag.active) {
        this.mesh.hide(i);
        this.mesh.setHeat(i, 0);
        continue;
      }
      this.mesh.write(i, frag, frame);
      this.mesh.setHeat(i, frag.heat);
    }
    this.mesh.commit();
  }
}
