import type { Vec2 } from '../sim/vec.ts';

/**
 * Debug handle helpers. The sim uses plain {x, z} vectors; these views let the console and the Playwright tests
 * keep treating positions like the THREE.Vector3s they used to be (y reads 0, set(x, y, z) works). Only the
 * debug handle uses them; the game reads the sim directly.
 */
export interface Vec3View {
  x: number;
  readonly y: number;
  z: number;
  set(x: number, y: number, z: number): Vec3View;
}

export function vec3View(v: Vec2): Vec3View {
  const view = {
    get x() {
      return v.x;
    },
    set x(n: number) {
      v.x = n;
    },
    get y() {
      return 0;
    },
    get z() {
      return v.z;
    },
    set z(n: number) {
      v.z = n;
    },
  } as Vec3View;
  // Not enumerable, so spreading or serialising a view gives a plain {x, y, z}.
  Object.defineProperty(view, 'set', {
    value: (x: number, _y: number, z: number) => {
      v.x = x;
      v.z = z;
      return view;
    },
  });
  return view;
}

function isVec2(value: unknown): value is Vec2 {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<Vec2>;
  return typeof v.x === 'number' && typeof v.z === 'number' && Object.keys(value).length === 2;
}

const views = new WeakMap<object, object>();
const arrays = new WeakMap<readonly object[], readonly object[]>();

/**
 * A live view of a sim object: its {x, z} vectors read as Vec3Views, everything else reads and writes straight
 * through. `extras` adds or overrides properties (debug-only helpers).
 */
export function objectView<T extends object>(target: T, extras?: object): T {
  const cached = extras ? undefined : (views.get(target) as T | undefined);
  if (cached) return cached;
  const vecs = new Map<PropertyKey, Vec3View>();
  const view = new Proxy(target, {
    get(t, key, receiver) {
      if (extras && key in extras) return Reflect.get(extras, key);
      const value: unknown = Reflect.get(t, key, receiver);
      if (!isVec2(value)) return value;
      let v = vecs.get(key);
      if (!v) vecs.set(key, (v = vec3View(value)));
      return v;
    },
  });
  if (!extras) views.set(target, view);
  return view;
}

/** Views of every object in a fixed sim pool (built once per pool). */
export function poolView<T extends object>(pool: readonly T[]): readonly T[] {
  let view = arrays.get(pool) as readonly T[] | undefined;
  if (!view || view.length !== pool.length) {
    view = pool.map((obj) => objectView(obj));
    arrays.set(pool, view);
  }
  return view;
}
