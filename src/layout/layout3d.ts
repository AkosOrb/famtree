import { NODE_H, NODE_W, type Layout, type UnionGeometry } from './layout';
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
  /** Radius of the surface the cards stand on. */
  radius: number;
  /** Radius of the outermost line layer in use. */
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
 * nearest layer with room, further in or further out. Children carry their
 * parents' family layer on as their branch's layer, so a branch keeps its depth
 * down the generations. Only lines use these layers; cards all stay on one surface.
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
  const minLayer = Math.min(0, ...layers.unions.values());
  const maxLayer = Math.max(0, ...layers.unions.values());
  // The innermost line layer must still be wide enough for the tree.
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
    // Every card, partners included, stands on the same surface: only the lines use depth.
    const c = at(p.x, p.y + NODE_H / 2, radius);
    persons.set(p.id, { ...c, id: p.id, angle: angleOf(p.x), gen: p.gen });
  }

  const out: number[] = [];
  const push = (a: Point3, b: Point3) => out.push(a.x, a.y, a.z, b.x, b.y, b.z);
  /** A line along the curve from x1 to x2. */
  const horizontal = (x1: number, x2: number, y: number, r: number) => {
    const n = Math.max(1, Math.ceil(Math.abs(x2 - x1) / SEGMENT));
    for (let i = 0; i < n; i++) push(at(x1 + ((x2 - x1) * i) / n, y, r), at(x1 + ((x2 - x1) * (i + 1)) / n, y, r));
  };

  for (const u of layout.unions) {
    const ru = radiusOf(layers.unions.get(u.id) ?? 0);
    const partners = u.partners.map((id) => layout.persons.get(id)).filter((p) => !!p);
    const kids = u.children.map((id) => layout.persons.get(id)).filter((p) => !!p);
    if (partners.length === 2) {
      const [a, b] = [...partners].sort((p, q) => p.x - q.x);
      horizontal(a.x + NODE_W / 2, b.x - NODE_W / 2, a.y + NODE_H / 2, radius);
    }
    if (!kids.length) continue;
    // The family's lines leave the surface for its own layer: down from the parents to the
    // sibling line, along it, and back to the surface at each child.
    const xs = [u.x, ...kids.map((k) => k.x)];
    push(at(u.x, u.y, radius), at(u.x, u.barY, ru));
    horizontal(Math.min(...xs), Math.max(...xs), u.barY, ru);
    for (const k of kids) push(at(k.x, u.barY, ru), at(k.x, k.y, radius));
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
