import { describe, expect, it } from 'vitest';
import { generateTree, inLawTree } from '../model/sample';
import { computeLayout, NODE_W } from './layout';
import type { Id } from '../model/types';
import { assignLayers, computeLayout3D, LAYER_GAP, MIN_RADIUS } from './layout3d';

describe('3D layout', () => {
  it('keeps everyone on their layer of the cylinder, older generations higher', () => {
    const l = computeLayout(inLawTree());
    const l3 = computeLayout3D(l);
    expect(l3.persons.size).toBe(l.persons.size);
    for (const p of l3.persons.values()) {
      expect(Math.hypot(p.x, p.z)).toBeCloseTo(l3.radius + p.layer * LAYER_GAP, 6);
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
  });

  it('moves families whose lines would cross into another layer, and keeps the rest together', () => {
    const layout = computeLayout(generateTree(2000, 1, 0.3));
    const { unions, persons } = assignLayers(layout);
    const byGapLayer = new Map<string, [number, number][]>();
    for (const u of layout.unions) {
      const kids = u.children.map((id) => layout.persons.get(id)).filter((p) => !!p);
      if (!kids.length) continue;
      const gen = layout.persons.get(u.partners[0])!.gen;
      const xs = [u.x, ...kids.map((k) => k.x)];
      const key = `${gen}:${unions.get(u.id)}`;
      byGapLayer.set(key, [...(byGapLayer.get(key) ?? []), [Math.min(...xs), Math.max(...xs)]]);
      // Children stand in their family's layer until they have a family of their own.
      const asPartner = new Set(layout.unions.flatMap((v) => v.partners));
      for (const k of kids) if (!asPartner.has(k.id)) expect(persons.get(k.id)).toBe(unions.get(u.id));
    }
    for (const spans of byGapLayer.values()) {
      spans.sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < spans.length; i++) expect(spans[i][0]).toBeGreaterThan(spans[i - 1][1]);
    }
    const used = new Set(unions.values());
    expect(used.size).toBeGreaterThan(1);
    // Depth is only used where lines would meet: the base layer stays the fullest.
    const count = new Map<number, number>();
    for (const l of persons.values()) count.set(l, (count.get(l) ?? 0) + 1);
    const fullest = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
    expect(fullest).toBe(0);
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
});
