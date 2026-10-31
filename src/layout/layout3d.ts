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
/**
 * Vertical stretch of the generations, so the stepped tower rises steeply. Only the room
 * between the rows is stretched: the cards keep their size, so the lines still meet them.
 */
export const Y_SCALE = 2.2;
/** Room between the outermost layer of one generation's cylinder and the innermost of the next. */
const GEN_GAP = 90;
/** Distance between two depth layers. */
export const LAYER_GAP = 120;
/** Share of the room between two rows that the lines run straight down before they fan out. */
const STEM = 0.2;
/** Share of the circumference left empty, so the two ends of a wide tree do not touch. */
const WRAP_GAP = 0.08;
/** Longest straight piece of a horizontal line before it is bent to follow the curve. */
const SEGMENT = 60;

/** A family's lines down to its children: from the family point `x` to each child's `kids` x. */
interface Fan {
  x: number;
  lo: number;
  hi: number;
}

/** Whether the lines of two families in the same generation gap cross (one reaches past the other). */
const fansCross = (a: Fan, b: Fan) => (a.x < b.x ? a.hi > b.lo : a.x > b.x ? a.lo < b.hi : a.lo < b.hi && b.lo < a.hi);

/**
 * Gives every family (union) a depth layer. The lines from a family run
 * straight from the parents to each child, so in a plain line of descent they
 * never cross. A family stays in the layer of its own branch while its lines
 * cross no other family's there; when they would (a child who married in, far
 * from their own parents), it moves to the nearest layer where they do not,
 * further in or further out. Children stand in their
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
  /** Families already placed, per generation gap and layer. */
  const used = new Map<number, Map<number, Fan[]>>();

  for (const u of unions) {
    const partners = u.partners.filter((id) => layout.persons.has(id));
    const kids = u.children.map((id) => layout.persons.get(id)).filter((p) => !!p);
    const known = partners.map((id) => personLayer.get(id)).filter((l) => l != null);
    const preferred = known.length ? Math.round(known.reduce((a, b) => a + b, 0) / known.length) : 0;

    let layer = preferred;
    if (kids.length) {
      const xs = kids.map((k) => k.x);
      const fan = { x: u.x, lo: Math.min(...xs), hi: Math.max(...xs) };
      const gap = used.get(genOf(u)) ?? new Map<number, Fan[]>();
      used.set(genOf(u), gap);
      const free = (l: number) => !(gap.get(l) ?? []).some((f) => fansCross(f, fan));
      if (!free(layer)) {
        for (let k = 1; ; k++) {
          // Toward the base layer if only one side is free or both are, so depth does not pile
          // up over the generations; between equally deep sides, the emptier one.
          const candidates = [preferred + k, preferred - k].filter(free);
          if (!candidates.length) continue;
          candidates.sort((a, b) => Math.abs(a) - Math.abs(b) || (gap.get(a)?.length ?? 0) - (gap.get(b)?.length ?? 0));
          layer = candidates[0];
          break;
        }
      }
      const fans = gap.get(layer) ?? [];
      fans.push(fan);
      gap.set(layer, fans);
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
  const rows = Math.round((bounds.maxY - bounds.minY - NODE_H) / ROW_H) + 1;
  const rowStep = ROW_H * Y_SCALE;
  const height = (rows - 1) * rowStep + NODE_H;
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
  const top = height / 2;
  /** Stretch for the room between two rows, so that a row and its gap add up to `rowStep`. */
  const gapStretch = (rowStep - NODE_H) / (ROW_H - NODE_H);
  /** Height in 3D of a 2D y: within a card's row unchanged, so lines meet the cards; between rows stretched. */
  const heightOf = (y: number) => {
    const row = Math.floor((y - bounds.minY) / ROW_H);
    const d = y - bounds.minY - row * ROW_H;
    return top - row * rowStep - (d <= NODE_H ? d : NODE_H + (d - NODE_H) * gapStretch);
  };

  const angleOf = (x: number) => (x - midX) / radius;
  const at = (x: number, y: number, r: number): Point3 => {
    const a = angleOf(x);
    return { x: r * Math.sin(a), y: heightOf(y), z: r * Math.cos(a) };
  };

  const persons = new Map<Id, Person3D>();
  for (const p of layout.persons.values()) {
    const layer = layers.persons.get(p.id) ?? 0;
    const c = at(p.x, p.y + NODE_H / 2, radiusOf(layer, p.gen));
    persons.set(p.id, { ...c, id: p.id, angle: angleOf(p.x), gen: p.gen, layer });
  }

  type Out = number[];
  const push = (out: Out, a: Point3, b: Point3) => out.push(a.x, a.y, a.z, b.x, b.y, b.z);
  /** A line from (x1, y1) to (x2, y2) that follows the curve, moving from depth r1 to r2 on the way. */
  const along = (out: Out, x1: number, y1: number, r1: number, x2: number, y2: number, r2: number) => {
    const n = Math.max(1, Math.ceil(Math.abs(x2 - x1) / SEGMENT));
    const pt = (t: number) => at(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, r1 + (r2 - r1) * t);
    for (let i = 0; i < n; i++) push(out, pt(i / n), pt((i + 1) / n));
  };
  const horizontal = (out: Out, x1: number, x2: number, y: number, r1: number, r2 = r1) =>
    along(out, x1, y, r1, x2, y, r2);
  const rp = (id: Id) => radiusOf(layers.persons.get(id) ?? 0, layout.persons.get(id)?.gen ?? 0);
  const genOfUnion = (u: UnionGeometry) => {
    const gens = u.partners.map((id) => layout.persons.get(id)?.gen).filter((g) => g != null);
    return gens.length ? Math.min(...gens) : 0;
  };
  /** The family's radius on the parents' cylinder, or on generation `gen`'s. */
  const ruOf = (u: UnionGeometry, gen = genOfUnion(u)) => radiusOf(layers.unions.get(u.id) ?? 0, gen);
  /** Where the family's lines stop running straight down below the parents and fan out. */
  const fanY = (u: UnionGeometry) => bounds.minY + genOfUnion(u) * ROW_H + NODE_H + STEM * (ROW_H - NODE_H);

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
  /**
   * From the family point down to one child: straight down from between the parents, then
   * straight across to just above the child, then down onto the child's card. Every family's
   * lines turn at the same heights, so two families' lines only cross where one reaches past
   * the other, and those families stand in different layers.
   */
  const stem = (out: Out, u: UnionGeometry) => push(out, at(u.x, u.y, ruOf(u)), at(u.x, fanY(u), ruOf(u)));
  const toChild = (out: Out, u: UnionGeometry, child: PersonBox) => {
    const above = child.y - STEM * (ROW_H - NODE_H);
    const r = ruOf(u, child.gen);
    along(out, u.x, fanY(u), ruOf(u), child.x, above, r);
    // Onto the child's card (in the child's own family layer, if they have moved).
    push(out, at(child.x, above, r), at(child.x, child.y, rp(child.id)));
  };

  const out: Out = [];
  for (const u of layout.unions) {
    const partners = u.partners.map((id) => layout.persons.get(id)).filter((p) => !!p);
    const kids = u.children.map((id) => layout.persons.get(id)).filter((p) => !!p);
    // Partners share the family's layer; only someone with a second family can stand elsewhere.
    for (const p of partners) partnerToFamily(out, u, p);
    if (!kids.length) continue;
    stem(out, u);
    for (const k of kids) toChild(out, u, k);
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
      stem(res, u);
      toChild(res, u, c);
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
      radiusOf(maxLayer, Math.min(maxGen, Math.max(0, Math.round((top - NODE_H / 2 - y) / rowStep)))),
    height,
    wrapped: maxAngle > Math.PI / 2,
  };
}
