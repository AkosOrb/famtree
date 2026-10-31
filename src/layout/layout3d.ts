import { NODE_H, NODE_W, ROW_H, type Layout, type PersonBox, type UnionGeometry } from './layout';
import type { Relation } from '../model/relationship';
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
  /** Radius of the oldest generation's cylinder. */
  radius: number;
  /** How much wider each generation's cylinder is than the one above it. */
  genStep: number;
  /** Radius of the outermost line layer in use. */
  outerRadius: number;
  height: number;
  /** True when the tree reaches round to the back of the cylinder. */
  wrapped: boolean;
  /** Outermost radius used at height `y` (the cylinder of the generation there). */
  shellRadius: (y: number) => number;
  /**
   * The tree lines between two related people, as pairs of points like `edges`:
   * `relation` is what `to` is to `from`. Empty when they are not directly linked.
   */
  link: (from: Id, to: Id, relation: Relation) => number[];
}

/** Below this radius a tree is not wrapped into a full circle. */
export const MIN_RADIUS = 1200;
/** Room between the outermost layer of one generation's cylinder and the innermost of the next. */
const GEN_GAP = 200;
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
 * parents' family layer, so a branch keeps its depth down the generations,
 * until they start a family of their own: a couple always shares one layer.
 */
export function assignLayers(layout: Layout): { persons: Map<Id, number>; unions: Map<Id, number> } {
  const personLayer = new Map<Id, number>();
  const unionLayer = new Map<Id, number>();
  /** Persons already placed with their own (first) family, as a partner. */
  const settled = new Set<Id>();
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
    // Both partners stand in their family's layer, so a couple is never split.
    for (const id of partners) {
      if (settled.has(id)) continue;
      settled.add(id);
      personLayer.set(id, layer);
    }
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
  const minLayer = Math.min(0, ...layers.unions.values(), ...layers.persons.values());
  const maxLayer = Math.max(0, ...layers.unions.values(), ...layers.persons.values());
  // The innermost layer must still be wide enough for the tree.
  const radius = Math.max(
    MIN_RADIUS - minLayer * LAYER_GAP,
    width / (2 * Math.PI * (1 - WRAP_GAP)) - minLayer * LAYER_GAP,
  );
  /**
   * Each generation stands on its own cylinder, one step wider than the one above, so the
   * tree reads as a stepped tower; depth layers are offsets from a generation's cylinder.
   * Fractional generations are the sibling lines between two cylinders.
   */
  // Wide enough that the layers of two generations never reach into each other.
  const genStep = (maxLayer - minLayer) * LAYER_GAP + GEN_GAP;
  const radiusOf = (layer: number, gen: number) => radius + gen * genStep + layer * LAYER_GAP;
  const maxGen = Math.max(0, ...[...layout.persons.values()].map((p) => p.gen));
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
    const c = at(p.x, p.y + NODE_H / 2, radiusOf(layer, p.gen));
    persons.set(p.id, { ...c, id: p.id, angle: angleOf(p.x), gen: p.gen, layer });
  }

  type Out = number[];
  const push = (out: Out, a: Point3, b: Point3) => out.push(a.x, a.y, a.z, b.x, b.y, b.z);
  /** A line along the curve from x1 to x2, moving from depth r1 to r2 on the way. */
  const horizontal = (out: Out, x1: number, x2: number, y: number, r1: number, r2 = r1) => {
    const n = Math.max(1, Math.ceil(Math.abs(x2 - x1) / SEGMENT));
    for (let i = 0; i < n; i++) {
      const t0 = i / n;
      const t1 = (i + 1) / n;
      push(out, at(x1 + (x2 - x1) * t0, y, r1 + (r2 - r1) * t0), at(x1 + (x2 - x1) * t1, y, r1 + (r2 - r1) * t1));
    }
  };
  const rp = (id: Id) => radiusOf(layers.persons.get(id) ?? 0, layout.persons.get(id)?.gen ?? 0);
  const genOfUnion = (u: UnionGeometry) => {
    const gens = u.partners.map((id) => layout.persons.get(id)?.gen).filter((g) => g != null);
    return gens.length ? Math.min(...gens) : 0;
  };
  /** The family's radius on the parents' cylinder (`at` 0) or at its sibling line (`at` 0.5). */
  const ruOf = (u: UnionGeometry, step = 0) => radiusOf(layers.unions.get(u.id) ?? 0, genOfUnion(u) + step);

  /** From a partner's card to the family point (the start of the line down to the children). */
  const partnerToFamily = (out: Out, u: UnionGeometry, partner: PersonBox) => {
    const ru = ruOf(u);
    const others = u.partners.filter((id) => id !== partner.id && layout.persons.has(id));
    if (!others.length) {
      if (rp(partner.id) !== ru) push(out, at(u.x, u.y, rp(partner.id)), at(u.x, u.y, ru));
      return;
    }
    const edge = partner.x < u.x ? partner.x + NODE_W / 2 : partner.x - NODE_W / 2;
    horizontal(out, edge, u.x, partner.y + NODE_H / 2, rp(partner.id), ru);
  };
  /** From the family point down to one child. */
  const familyToChild = (out: Out, u: UnionGeometry, child: PersonBox) => {
    const rb = ruOf(u, 0.5);
    // Down from the parents' cylinder to the sibling line, half a step wider.
    push(out, at(u.x, u.y, ruOf(u)), at(u.x, u.barY, rb));
    horizontal(out, u.x, child.x, u.barY, rb);
    // On to the child's cylinder (and the child's own family layer, if they have moved).
    push(out, at(child.x, u.barY, rb), at(child.x, child.y, rp(child.id)));
  };

  const out: Out = [];
  for (const u of layout.unions) {
    const partners = u.partners.map((id) => layout.persons.get(id)).filter((p) => !!p);
    const kids = u.children.map((id) => layout.persons.get(id)).filter((p) => !!p);
    // Partners share the family's layer; only someone with a second family can stand elsewhere.
    for (const p of partners) partnerToFamily(out, u, p);
    if (!kids.length) continue;
    const rb = ruOf(u, 0.5);
    const xs = [u.x, ...kids.map((k) => k.x)];
    push(out, at(u.x, u.y, ruOf(u)), at(u.x, u.barY, rb));
    horizontal(out, Math.min(...xs), Math.max(...xs), u.barY, rb);
    for (const k of kids) push(out, at(k.x, u.barY, rb), at(k.x, k.y, rp(k.id)));
  }

  const link = (from: Id, to: Id, relation: Relation): number[] => {
    const res: Out = [];
    const [parent, child] = relation === 'parent' ? [to, from] : [from, to];
    for (const u of layout.unions) {
      if (relation === 'partner') {
        if (!u.partners.includes(from) || !u.partners.includes(to)) continue;
        for (const id of [from, to]) partnerToFamily(res, u, layout.persons.get(id)!);
        return res;
      }
      if (!u.partners.includes(parent) || !u.children.includes(child)) continue;
      const p = layout.persons.get(parent);
      const c = layout.persons.get(child);
      if (!p || !c) return res;
      partnerToFamily(res, u, p);
      familyToChild(res, u, c);
      return res;
    }
    return res;
  };

  let maxAngle = 0;
  for (const p of persons.values()) maxAngle = Math.max(maxAngle, Math.abs(p.angle));
  return {
    persons,
    edges: new Float32Array(out),
    link,
    radius,
    genStep,
    outerRadius: radiusOf(maxLayer, maxGen),
    shellRadius: (y: number) =>
      radiusOf(maxLayer, Math.min(maxGen, Math.max(0, Math.round((midY - y - NODE_H / 2) / ROW_H)))),
    height,
    wrapped: maxAngle > Math.PI / 2,
  };
}
