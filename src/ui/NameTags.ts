import * as THREE from 'three';
import { HOLES } from '../config';
import type { HoleMesh } from '../player/HoleMesh';
import type { Hole } from '../sim/Hole.ts';
import { FONT } from './dom';

const tmp = new THREE.Vector3();
const tmpEdge = new THREE.Vector3();

/** Colours of a name by how the hole compares to the local one: it can eat you, you can eat it, or neither. */
const COLORS = { local: '#ffd9a0', threat: '#ff8f7d', prey: '#a6efb2', neutral: '#dfe6f5' } as const;
type Kind = keyof typeof COLORS;

interface Tag {
  el: HTMLDivElement;
  text: string;
  kind: Kind | '';
}

/**
 * Nicknames over the holes in view (the player's own, other players' and the bots'), as DOM labels above each hole.
 * A pool of elements, moved by transform each frame; the text is set only when it changes (always textContent:
 * nicknames come from players). A name is coloured red when that hole is big enough to eat the local one and green
 * when the local one can eat it, so the size rule reads at a glance.
 */
export class NameTags {
  private readonly root = document.createElement('div');
  private readonly tags: Tag[] = [];
  private used = 0;

  constructor(parent: HTMLElement = document.body) {
    Object.assign(this.root.style, { position: 'fixed', inset: '0', overflow: 'hidden', pointerEvents: 'none', zIndex: '4' });
    this.root.dataset.testid = 'name-tags';
    parent.append(this.root);
  }

  /** Start a frame. */
  begin(): void {
    this.used = 0;
  }

  /** Label a hole drawn as `mesh`. `local` is the local player's hole. */
  add(hole: Hole, mesh: HoleMesh, local: Hole, camera: THREE.PerspectiveCamera, width: number, height: number): void {
    const centre = tmp.copy(mesh.position).project(camera);
    if (centre.z > 1 || Math.abs(centre.x) > 1.1 || Math.abs(centre.y) > 1.1) return;
    // The core's radius on screen, from the projected point one radius to the side of the centre.
    const edge = tmpEdge.set(mesh.position.x + mesh.radius, mesh.position.y, mesh.position.z).project(camera);
    const radiusPx = Math.abs(edge.x - centre.x) * 0.5 * width;
    const x = (centre.x * 0.5 + 0.5) * width;
    const y = (-centre.y * 0.5 + 0.5) * height - Math.max(radiusPx * 2.1, 10) - 4;
    const kind: Kind =
      hole === local
        ? 'local'
        : hole.radius >= local.radius * HOLES.eatRatio * 0.98
          ? 'threat'
          : local.radius >= hole.radius * HOLES.eatRatio
            ? 'prey'
            : 'neutral';
    const tag = this.tag(this.used++);
    if (tag.text !== hole.name) {
      tag.text = hole.name;
      tag.el.textContent = hole.name;
    }
    if (tag.kind !== kind) {
      tag.kind = kind;
      tag.el.style.color = COLORS[kind];
    }
    tag.el.style.display = 'block';
    tag.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
  }

  /** End a frame: hide the labels not used. */
  end(): void {
    for (let i = this.used; i < this.tags.length; i++) this.tags[i].el.style.display = 'none';
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'block' : 'none';
  }

  private tag(i: number): Tag {
    let tag = this.tags[i];
    if (!tag) {
      const el = document.createElement('div');
      Object.assign(el.style, {
        position: 'absolute',
        left: '0',
        top: '0',
        font: `600 13px/1 ${FONT}`,
        letterSpacing: '0.04em',
        whiteSpace: 'nowrap',
        textShadow: '0 0 4px #000, 0 0 8px #000, 0 1px 2px #000',
        willChange: 'transform',
      });
      el.dataset.testid = 'name-tag';
      this.root.append(el);
      tag = { el, text: '', kind: '' };
      this.tags.push(tag);
    }
    return tag;
  }
}
