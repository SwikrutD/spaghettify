import * as THREE from 'three';
import { PREY_POOL_SIZE } from '../config';
import type { PreyField } from '../sim/PreyField.ts';
import { PreyMesh, type BodyFrame } from './PreyMesh';

/**
 * The prey pool drawn as two InstancedMeshes over the same slots (see PreyMesh): lumpy rocks and smooth round
 * bodies (planets, moons). Each slot is drawn in the mesh of its shape and hidden in the other, so it is two
 * draw calls in all. Only the live slots (the tier's entity budget) are drawn.
 */
export class PreyFieldMesh {
  /** Both meshes; add this to the scene. */
  readonly group = new THREE.Group();
  private readonly rocks = new PreyMesh(PREY_POOL_SIZE, 'rock');
  private readonly spheres = new PreyMesh(PREY_POOL_SIZE, 'sphere');
  private readonly field: PreyField;

  constructor(field: PreyField) {
    this.field = field;
    this.group.add(this.rocks.mesh, this.spheres.mesh);
  }

  /** The mesh slot i is drawn in (its instance index is i). */
  meshOf(i: number): THREE.InstancedMesh {
    return (this.field.objects[i].round ? this.spheres : this.rocks).mesh;
  }

  update(frame: BodyFrame): void {
    const count = this.field.liveCount;
    this.rocks.mesh.count = count;
    this.spheres.mesh.count = count;
    this.rocks.setHole(frame);
    this.spheres.setHole(frame);
    for (let i = 0; i < count; i++) {
      const obj = this.field.objects[i];
      (obj.round ? this.spheres : this.rocks).write(i, obj, frame);
      (obj.round ? this.rocks : this.spheres).hide(i);
    }
    this.rocks.commit();
    this.spheres.commit();
  }
}
