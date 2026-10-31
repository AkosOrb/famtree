import { describe, expect, it } from 'vitest';
import { generateTree, inLawTree } from '../model/sample';
import { computeLayout, NODE_W } from './layout';
import { computeLayout3D, MIN_RADIUS } from './layout3d';

describe('3D layout', () => {
  it('keeps everyone on the cylinder, older generations higher', () => {
    const l = computeLayout(inLawTree());
    const l3 = computeLayout3D(l);
    expect(l3.persons.size).toBe(l.persons.size);
    for (const p of l3.persons.values()) {
      expect(Math.hypot(p.x, p.z)).toBeCloseTo(l3.radius, 6);
    }
    const byGen = new Map<number, number>();
    for (const p of l3.persons.values()) byGen.set(p.gen, p.y);
    const gens = [...byGen.keys()].sort((a, b) => a - b);
    for (let i = 1; i < gens.length; i++) expect(byGen.get(gens[i])!).toBeLessThan(byGen.get(gens[i - 1])!);
  });

  it('bends a small tree only gently and wraps a wide one without the ends meeting', () => {
    const small = computeLayout3D(computeLayout(inLawTree()));
    expect(small.radius).toBe(MIN_RADIUS);

    const wide = computeLayout3D(computeLayout(generateTree(2000, 1, 0.3)));
    const angles = [...wide.persons.values()].map((p) => p.angle);
    const span = Math.max(...angles) - Math.min(...angles);
    expect(span).toBeLessThan(2 * Math.PI - NODE_W / wide.radius);
    expect(wide.edges.length % 6).toBe(0);
    expect(wide.edges.every(Number.isFinite)).toBe(true);
  });
});
