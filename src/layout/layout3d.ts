import { NODE_H, NODE_W, type Layout, type PersonBox, type UnionGeometry } from './layout';
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
  /** Depth layer: 0 is the base surface, positive further out, negative further in. */
  layer: number;
}

export interface Layout3D {
  persons: Map<Id, Person3D>;
  /** Pairs of points, flattened: [ax, ay, az, bx, by, bz, ...]. */
  edges: Float32Array;
  /** Radius of the base layer. */
  radius: number;
  /** Radius of the outermost layer in use. */
  outerRadius: number;
  height: number;
  /** True when the tree reaches round to the back of the cylinder. */
  wrapped: boolean;
}

/** Below this radius a tree is not wrapped into a full circle. */
export const MIN_RADIUS = 900;
/** Distance between two depth layers. */
export const LAYER_GAP = 170;
/** Share of the circumference left empty, so the two ends of a wide tree do not touch. */
const WRAP_GAP = 0.08;
/** Longest straight piece of a horizontal line before it is bent to follow the curve. */
const SEGMENT = 60;
/** Room kept between the lines of two families in the same layer. */
const LINE_GAP = 24;

interface Span {
  from: number;
  to: number;
}

/**
 * Gives every family (union) a depth layer. A family stays in the layer of its
 * own branch while its lines have room there; when its sibling line would run
 * into another family's line in the same generation gap, it moves to the
 * nearest layer with room, further in or further out. Children stand in their
 * parents' family layer, so a branch keeps its depth down the generations.
 */
export function assignLayers(layout: Layout): { persons: Map<Id, number>; unions: Map<Id, number> } {
  const personLayer = new Map<Id, number>();
  const unionLayer = new Map<Id, number>();
  const genOf = (u: UnionGeometry) => {
    const gens = u.partners.map((id) => layout.persons.get(id)?.gen).filter((g) => g != null);
    return gens.length ? Math.min(...gens) : 0;
  };
  const unions = [...layout.unions].sort((a, b) => genOf(a) - genOf(b) || a.x - b.x);
  /** Occupied line spans per generation gap and layer. */
  const used = new Map<number, Map<number, Span[]>>();

  for (const u of unions) {
    const partners = u.partners.filter((id) => layout.persons.has(id));
    const kids = u.children.map((id) => layout.persons.get(id)).filter((p) => !!p);
    const known = partners.map((id) => personLayer.get(id)).filter((l) => l != null);
    const preferred = known.length ? Math.round(known.reduce((a, b) => a + b, 0) / known.length) : 0;

    let layer = preferred;
    if (kids.length) {
      const xs = [u.x, ...kids.map((k) => k.x)];
      const span = { from: Math.min(...xs) - LINE_GAP / 2, to: Math.max(...xs) + LINE_GAP / 2 };
      const gap = used.get(genOf(u)) ?? new Map<number, Span[]>();
      used.set(genOf(u), gap);
      /** Distance to the nearest line already in `l`; negative when they overlap. */
      const room = (l: number) => {
        let best = Infinity;
        for (const s of gap.get(l) ?? []) best = Math.min(best, Math.max(s.from - span.to, span.from - s.to));
        return best;
      };
      if (room(layer) < 0) {
        for (let k = 1; ; k++) {
          const out = room(preferred + k);
          const inn = room(preferred - k);
          if (out < 0 && inn < 0) continue;
          // Toward the base layer if only one side has room or both do, so depth does not pile up
          // over the generations; between equally deep sides, where there is more room.
          const candidates = [
            { l: preferred + k, room: out },
            { l: preferred - k, room: inn },
          ].filter((c) => c.room >= 0);
          candidates.sort((a, b) => Math.abs(a.l) - Math.abs(b.l) || b.room - a.room);
          layer = candidates[0].l;
          break;
        }
      }
      const spans = gap.get(layer) ?? [];
      spans.push(span);
      gap.set(layer, spans);
    }
    unionLayer.set(u.id, layer);
    // Partners who married in sit with the family they joined.
    for (const id of partners) if (!personLayer.has(id)) personLayer.set(id, layer);
    for (const k of kids) if (!personLayer.has(k.id)) personLayer.set(k.id, layer);
  }
  for (const id of layout.persons.keys()) if (!personLayer.has(id)) personLayer.set(id, 0);
  return { persons: personLayer, unions: unionLayer };
}

export function computeLayout3D(layout: Layout): Layout3D {
  const { bounds } = layout;
  const width = bounds.maxX - bounds.minX + NODE_W;
  const height = bounds.maxY - bounds.minY + NODE_H;
  const layers = assignLayers(layout);
  const minLayer = Math.min(0, ...layers.persons.values(), ...layers.unions.values());
  const maxLayer = Math.max(0, ...layers.persons.values(), ...layers.unions.values());
  // The innermost layer must still be wide enough for the tree.
  const radius = Math.max(
    MIN_RADIUS - minLayer * LAYER_GAP,
    width / (2 * Math.PI * (1 - WRAP_GAP)) - minLayer * LAYER_GAP,
  );
  const radiusOf = (layer: number) => radius + layer * LAYER_GAP;
  const midX = (bounds.minX + bounds.maxX) / 2;
  const midY = (bounds.minY + bounds.maxY + NODE_H) / 2;

  const angleOf = (x: number) => (x - midX) / radius;
  const at = (x: number, y: number, r: number): Point3 => {
    const a = angleOf(x);
    return { x: r * Math.sin(a), y: midY - y, z: r * Math.cos(a) };
  };

  const persons = new Map<Id, Person3D>();
  for (const p of layout.persons.values()) {
    const layer = layers.persons.get(p.id) ?? 0;
    const c = at(p.x, p.y + NODE_H / 2, radiusOf(layer));
    persons.set(p.id, { ...c, id: p.id, angle: angleOf(p.x), gen: p.gen, layer });
  }

  const out: number[] = [];
  const push = (a: Point3, b: Point3) => out.push(a.x, a.y, a.z, b.x, b.y, b.z);
  const vertical = (x: number, y1: number, y2: number, r: number) => push(at(x, y1, r), at(x, y2, r));
  /** A line along the curve from x1 to x2, moving from depth r1 to r2 on the way. */
  const horizontal = (x1: number, x2: number, y: number, r1: number, r2 = r1) => {
    const n = Math.max(1, Math.ceil(Math.abs(x2 - x1) / SEGMENT));
    for (let i = 0; i < n; i++) {
      const t0 = i / n;
      const t1 = (i + 1) / n;
      push(at(x1 + (x2 - x1) * t0, y, r1 + (r2 - r1) * t0), at(x1 + (x2 - x1) * t1, y, r1 + (r2 - r1) * t1));
    }
  };

  for (const u of layout.unions) {
    const ru = radiusOf(layers.unions.get(u.id) ?? 0);
    const partners = u.partners.map((id) => layout.persons.get(id)).filter((p) => !!p);
    const kids = u.children.map((id) => layout.persons.get(id)).filter((p) => !!p);
    const rp = (p: PersonBox) => radiusOf(layers.persons.get(p.id) ?? 0);
    if (partners.length === 2) {
      // Each partner to the family point between them, which sits in the family's layer.
      const [a, b] = [...partners].sort((p, q) => p.x - q.x);
      horizontal(a.x + NODE_W / 2, u.x, a.y + NODE_H / 2, rp(a), ru);
      horizontal(u.x, b.x - NODE_W / 2, b.y + NODE_H / 2, ru, rp(b));
    } else if (partners.length === 1 && rp(partners[0]) !== ru) {
      push(at(u.x, u.y, rp(partners[0])), at(u.x, u.y, ru));
    }
    if (!kids.length) continue;
    const xs = [u.x, ...kids.map((k) => k.x)];
    vertical(u.x, u.y, u.barY, ru);
    horizontal(Math.min(...xs), Math.max(...xs), u.barY, ru);
    for (const k of kids) {
      if (rp(k) !== ru) push(at(k.x, u.barY, ru), at(k.x, u.barY, rp(k)));
      vertical(k.x, u.barY, k.y, rp(k));
    }
  }

  let maxAngle = 0;
  for (const p of persons.values()) maxAngle = Math.max(maxAngle, Math.abs(p.angle));
  return {
    persons,
    edges: new Float32Array(out),
    radius,
    outerRadius: radiusOf(maxLayer),
    height,
    wrapped: maxAngle > Math.PI / 2,
  };
}
