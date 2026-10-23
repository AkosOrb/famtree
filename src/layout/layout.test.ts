import { describe, expect, it } from 'vitest';
import { generateTree, sampleTree } from '../model/sample';
import { computeLayout, NODE_W, PARTNER_GAP } from './layout';

function assertNoOverlap(layout: ReturnType<typeof computeLayout>) {
  const rows = new Map<number, number[]>();
  for (const p of layout.persons.values()) rows.set(p.y, [...(rows.get(p.y) ?? []), p.x]);
  for (const xs of rows.values()) {
    xs.sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(NODE_W + PARTNER_GAP - 1e-6);
  }
}

describe('layout', () => {
  it('places children one row below their parents', () => {
    const t = sampleTree();
    const layout = computeLayout(t);
    for (const u of Object.values(t.unions)) {
      const parentY = layout.persons.get(u.partners[0])!.y;
      for (const c of u.children) expect(layout.persons.get(c)!.y).toBeGreaterThan(parentY);
    }
    assertNoOverlap(layout);
  });

  it('lays out thousands of people quickly without overlaps', () => {
    const t = generateTree(3000);
    const start = performance.now();
    const layout = computeLayout(t);
    const elapsed = performance.now() - start;
    expect(layout.persons.size).toBe(Object.keys(t.persons).length);
    assertNoOverlap(layout);
    expect(elapsed).toBeLessThan(3000);
  });
});
