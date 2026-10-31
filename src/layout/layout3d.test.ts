import { describe, expect, it } from 'vitest';
import { generateTree, inLawTree } from '../model/sample';
import { computeLayout, NODE_H, NODE_W } from './layout';
import type { Id } from '../model/types';
import { directLinks } from './links';
import { assignLayers, computeLayout3D, LAYER_GAP, MIN_RADIUS } from './layout3d';

describe('3D layout', () => {
  it('puts each generation on its own, wider cylinder, everyone on their layer, older generations higher', () => {
    const l = computeLayout(inLawTree());
    const l3 = computeLayout3D(l);
    expect(l3.persons.size).toBe(l.persons.size);
    for (const p of l3.persons.values()) {
      expect(Math.hypot(p.x, p.z)).toBeCloseTo(l3.radius + p.gen * l3.genStep + p.layer * LAYER_GAP, 6);
    }
    const byGen = new Map<number, number>();
    for (const p of l3.persons.values()) byGen.set(p.gen, p.y);
    const gens = [...byGen.keys()].sort((a, b) => a - b);
    for (let i = 1; i < gens.length; i++) expect(byGen.get(gens[i])!).toBeLessThan(byGen.get(gens[i - 1])!);
  });

  it('bends a small tree only gently and wraps a wide one without the ends meeting', () => {
    const small = computeLayout3D(computeLayout(inLawTree()));
    expect(small.radius).toBeLessThan(MIN_RADIUS + 5 * LAYER_GAP);

    const wide = computeLayout3D(computeLayout(generateTree(2000, 1, 0.3)));
    const angles = [...wide.persons.values()].map((p) => p.angle);
    const span = Math.max(...angles) - Math.min(...angles);
    expect(span).toBeLessThan(2 * Math.PI - NODE_W / wide.radius);
    expect(wide.edges.length % 6).toBe(0);
    expect(wide.edges.every(Number.isFinite)).toBe(true);
    // Each generation's layers stay clear of the next generation's.
    const wideLayers = assignLayers(computeLayout(generateTree(2000, 1, 0.3)));
    const all = [...wideLayers.persons.values(), ...wideLayers.unions.values()];
    expect(wide.genStep).toBeGreaterThan((Math.max(...all) - Math.min(...all)) * LAYER_GAP);
  });

  it('moves families whose lines would cross into another layer, and keeps the rest together', () => {
    const layout = computeLayout(generateTree(2000, 1, 0.3));
    const { unions, persons } = assignLayers(layout);
    const byGapLayer = new Map<string, { x: number; lo: number; hi: number }[]>();
    for (const u of layout.unions) {
      const kids = u.children.map((id) => layout.persons.get(id)).filter((p) => !!p);
      if (!kids.length) continue;
      const gen = Math.min(...u.partners.map((id) => layout.persons.get(id)?.gen ?? Infinity));
      const xs = kids.map((k) => k.x);
      const key = `${gen}:${unions.get(u.id)}`;
      byGapLayer.set(key, [...(byGapLayer.get(key) ?? []), { x: u.x, lo: Math.min(...xs), hi: Math.max(...xs) }]);
      // Children stand in their family's layer until they have a family of their own.
      const asPartner = new Set(layout.unions.flatMap((v) => v.partners));
      for (const k of kids) if (!asPartner.has(k.id)) expect(persons.get(k.id)).toBe(unions.get(u.id));
    }
    // Within one layer, a family left of another has all its children left of the other's.
    for (const fans of byGapLayer.values()) {
      fans.sort((a, b) => a.x - b.x);
      let reach = -Infinity;
      for (const f of fans) {
        expect(f.lo).toBeGreaterThanOrEqual(reach);
        reach = Math.max(reach, f.hi);
      }
    }
    const used = new Set(unions.values());
    expect(used.size).toBeGreaterThan(1);
    // Depth is only used where lines would meet: the base layer stays the fullest.
    const count = new Map<number, number>();
    for (const l of persons.values()) count.set(l, (count.get(l) ?? 0) + 1);
    const fullest = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
    expect(fullest).toBe(0);
  });

  it('draws lines that meet the cards and never cross at the same depth', () => {
    /** Crossings of the lines seen from the axis outward, and whether each is at the same depth. */
    const crossings = (l3: ReturnType<typeof computeLayout3D>) => {
      const e = l3.edges;
      const segs: { a: number[]; b: number[] }[] = [];
      for (let i = 0; i < e.length; i += 6) {
        const p = (j: number) => [Math.atan2(e[j], e[j + 2]) * l3.radius, e[j + 1], Math.hypot(e[j], e[j + 2])];
        segs.push({ a: p(i), b: p(i + 3) });
      }
      let touching = 0;
      let behind = 0;
      for (let i = 0; i < segs.length; i++) {
        for (let j = i + 1; j < segs.length; j++) {
          const [p, q] = [segs[i], segs[j]];
          const d1 = [p.b[0] - p.a[0], p.b[1] - p.a[1]];
          const d2 = [q.b[0] - q.a[0], q.b[1] - q.a[1]];
          const den = d1[0] * d2[1] - d1[1] * d2[0];
          if (Math.abs(den) < 1e-9) continue;
          const w = [q.a[0] - p.a[0], q.a[1] - p.a[1]];
          const t = (w[0] * d2[1] - w[1] * d2[0]) / den;
          const u = (w[0] * d1[1] - w[1] * d1[0]) / den;
          if (t <= 1e-3 || t >= 1 - 1e-3 || u <= 1e-3 || u >= 1 - 1e-3) continue;
          const r1 = p.a[2] + (p.b[2] - p.a[2]) * t;
          const r2 = q.a[2] + (q.b[2] - q.a[2]) * u;
          if (Math.abs(r1 - r2) < LAYER_GAP / 2) touching++;
          else behind++;
        }
      }
      return { touching, behind };
    };
    // A plain line of descent has no crossings at all.
    expect(crossings(computeLayout3D(computeLayout(generateTree(400, 2))))).toEqual({ touching: 0, behind: 0 });
    // With in-laws, lines only pass in front of or behind each other, in different layers.
    expect(crossings(computeLayout3D(computeLayout(generateTree(400, 2, 0.3)))).touching).toBe(0);

    // Each child's line reaches the top edge of their card.
    const layout = computeLayout(inLawTree());
    const l3 = computeLayout3D(layout);
    const kids = new Set(layout.unions.flatMap((u) => u.children));
    for (const id of kids) {
      const p = l3.persons.get(id)!;
      let found = false;
      for (let i = 0; i < l3.edges.length; i += 3) {
        const [x, y, z] = [l3.edges[i], l3.edges[i + 1], l3.edges[i + 2]];
        if (Math.hypot(x - p.x, z - p.z) < 1 && Math.abs(y - (p.y + NODE_H / 2)) < 1e-6) found = true;
      }
      expect(found).toBe(true);
    }
  });

  it('never splits a couple between layers', () => {
    const layout = computeLayout(generateTree(2000, 1, 0.3));
    const { persons, unions } = assignLayers(layout);
    const families = new Map<Id, number>();
    for (const u of layout.unions) for (const p of u.partners) families.set(p, (families.get(p) ?? 0) + 1);
    let checked = 0;
    for (const u of layout.unions) {
      if (u.partners.length !== 2 || u.partners.some((p) => families.get(p) !== 1)) continue;
      expect(persons.get(u.partners[0])).toBe(unions.get(u.id));
      expect(persons.get(u.partners[1])).toBe(unions.get(u.id));
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('traces the lines between a person and each direct relative', () => {
    const layout = computeLayout(inLawTree());
    const l3 = computeLayout3D(layout);
    let checked = 0;
    for (const id of layout.persons.keys()) {
      for (const l of directLinks(layout, id)) {
        const pts = l3.link(id, l.id, l.relation);
        expect(pts.length).toBeGreaterThan(0);
        expect(pts.length % 6).toBe(0);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });
});
