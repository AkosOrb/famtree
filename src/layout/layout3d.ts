import { NODE_H, NODE_W, type Layout } from './layout';
import type { Id } from '../model/types';

/**
 * Maps the flat 2D layout onto the outside of a vertical cylinder, so a wide
 * tree wraps around and can be turned like a column instead of scrolled
 * sideways. Generations stay as rows: the oldest at the top. Small trees use
 * only part of the circumference and read as a gently curved wall.
 */

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export interface Person3D extends Point3 {
  id: Id;
  /** Angle around the cylinder axis; the card faces outward along it. */
  angle: number;
  gen: number;
}

export interface Layout3D {
  persons: Map<Id, Person3D>;
  /** Pairs of points, flattened: [ax, ay, az, bx, by, bz, ...]. */
  edges: Float32Array;
  radius: number;
  height: number;
  /** True when the tree reaches round to the back of the cylinder. */
  wrapped: boolean;
}

/** Below this radius a tree is not wrapped into a full circle. */
export const MIN_RADIUS = 900;
/** Share of the circumference left empty, so the two ends of a wide tree do not touch. */
const WRAP_GAP = 0.08;
/** Longest straight piece of a horizontal line before it is bent to follow the curve. */
const SEGMENT = 60;

export function computeLayout3D(layout: Layout): Layout3D {
  const { bounds } = layout;
  const width = bounds.maxX - bounds.minX + NODE_W;
  const height = bounds.maxY - bounds.minY + NODE_H;
  const radius = Math.max(MIN_RADIUS, width / (2 * Math.PI * (1 - WRAP_GAP)));
  const midX = (bounds.minX + bounds.maxX) / 2;
  const midY = (bounds.minY + bounds.maxY + NODE_H) / 2;

  const angleOf = (x: number) => (x - midX) / radius;
  const at = (x: number, y: number, r = radius): Point3 => {
    const a = angleOf(x);
    return { x: r * Math.sin(a), y: midY - y, z: r * Math.cos(a) };
  };

  const persons = new Map<Id, Person3D>();
  for (const p of layout.persons.values()) {
    const c = at(p.x, p.y + NODE_H / 2);
    persons.set(p.id, { ...c, id: p.id, angle: angleOf(p.x), gen: p.gen });
  }

  const out: number[] = [];
  const push = (a: Point3, b: Point3) => out.push(a.x, a.y, a.z, b.x, b.y, b.z);
  const vertical = (x: number, y1: number, y2: number) => push(at(x, y1), at(x, y2));
  const horizontal = (x1: number, x2: number, y: number) => {
    const n = Math.max(1, Math.ceil(Math.abs(x2 - x1) / SEGMENT));
    for (let i = 0; i < n; i++) push(at(x1 + ((x2 - x1) * i) / n, y), at(x1 + ((x2 - x1) * (i + 1)) / n, y));
  };

  for (const u of layout.unions) {
    const partners = u.partners.map((id) => layout.persons.get(id)).filter((p) => !!p);
    const kids = u.children.map((id) => layout.persons.get(id)).filter((p) => !!p);
    if (partners.length === 2) {
      const [a, b] = [...partners].sort((p, q) => p.x - q.x);
      horizontal(a.x + NODE_W / 2, b.x - NODE_W / 2, a.y + NODE_H / 2);
    }
    if (!kids.length) continue;
    const xs = [u.x, ...kids.map((k) => k.x)];
    vertical(u.x, u.y, u.barY);
    horizontal(Math.min(...xs), Math.max(...xs), u.barY);
    for (const k of kids) vertical(k.x, u.barY, k.y);
  }

  let maxAngle = 0;
  for (const p of persons.values()) maxAngle = Math.max(maxAngle, Math.abs(p.angle));
  return { persons, edges: new Float32Array(out), radius, height, wrapped: maxAngle > Math.PI / 2 };
}
