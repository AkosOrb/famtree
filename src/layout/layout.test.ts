import { describe, expect, it } from 'vitest';
import { generateTree, inLawTree, sampleTree } from '../model/sample';
import { computeLayout, NODE_W, PARTNER_GAP } from './layout';
import { countCrossings, countIntrusions } from './quality';
import { addChild, addParent, addPartner } from '../model/operations';

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

describe('layout with families that married in', () => {
  it('puts each partner on the side of their own family, without crossing lines', () => {
    const t = inLawTree();
    const layout = computeLayout(t);
    expect(countCrossings(t, layout)).toBe(0);
    expect(countIntrusions(t, layout)).toBe(0);
    assertNoOverlap(layout);
    const x = (name: string) =>
      layout.persons.get(Object.values(t.persons).find((p) => `${p.lastName} ${p.firstName}` === name)!.id)!.x;
    // Éva's parents and Éva are on the same side of the Kovács line.
    expect(Math.sign(x('Tóth Éva') - x('Kovács István'))).toBe(Math.sign(x('Tóth Sándor') - x('Kovács János')));
    expect(Math.sign(x('Nagy Péter') - x('Kovács Katalin'))).toBe(Math.sign(x('Nagy Lajos') - x('Kovács János')));
  });

  it('keeps crossings rare in a large tree with many in-law families', () => {
    const t = generateTree(2000, 7, 0.3);
    const layout = computeLayout(t);
    const edges = Object.values(t.unions).reduce((n, u) => n + u.children.length, 0);
    expect(countCrossings(t, layout)).toBeLessThan(edges * 0.05);
    expect(countIntrusions(t, layout)).toBeLessThan(edges * 0.1);
    assertNoOverlap(layout);
  });

  it('re-arranges as relatives are added, keeping sibling lines off unrelated cards', () => {
    let t = inLawTree();
    const find = (name: string) => Object.values(t.persons).find((p) => `${p.lastName} ${p.firstName}` === name)!.id;
    const person = (lastName: string, firstName: string, gender: 'male' | 'female') => ({
      lastName,
      firstName,
      gender,
    });
    let id: string;
    [t, id] = addPartner(t, find('Kovács Ferenc'), person('Fekete', 'Anikó', 'female'));
    [t] = addParent(t, id, person('Fekete', 'Béla', 'male'));
    [t] = addParent(t, id, person('Fehér', 'Erika', 'female'));
    [t, id] = addPartner(t, find('Nagy Bence'), person('Lakatos', 'Nóra', 'female'));
    [t] = addParent(t, id, person('Lakatos', 'Ottó', 'male'));
    [t] = addChild(t, find('Fekete Béla'), person('Fekete', 'Zoltán', 'male'), find('Fehér Erika'));
    const layout = computeLayout(t);
    expect(countIntrusions(t, layout)).toBe(0);
    // Three families married into one sibling group: one crossing cannot be avoided.
    expect(countCrossings(t, layout)).toBeLessThanOrEqual(1);
    assertNoOverlap(layout);
  });
});
