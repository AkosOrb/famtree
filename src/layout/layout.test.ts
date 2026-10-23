import { describe, expect, it } from 'vitest';
import { generateTree, inLawTree, sampleTree } from '../model/sample';
import { computeLayout, NODE_W, PARTNER_GAP } from './layout';
import { countCrossings, countIntrusions } from './quality';
import { addChild, addParent, addPartner, addPerson, linkPartners } from '../model/operations';
import { emptyTree } from '../model/types';

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
    // Three families married into one sibling group: one crossing cannot be avoided,
    // but the two families' sibling lines must not merge into one.
    expect(countCrossings(t, layout)).toBeLessThanOrEqual(1);
    assertNoOverlap(layout);
    const bars = layout.unions
      .filter((u) => u.children.length)
      .map((u) => {
        const xs = [u.x, ...u.children.map((c) => layout.persons.get(c)!.x)];
        return { y: u.barY, from: Math.min(...xs), to: Math.max(...xs) };
      });
    for (const a of bars) {
      for (const b of bars) {
        if (a !== b && a.y === b.y) expect(a.to < b.from || b.to < a.from).toBe(true);
      }
    }
  });

  it('keeps a younger sibling next to their siblings when two families are linked by a later marriage', () => {
    // Two lines of grandparents, each with a child who married; their grandchildren
    // marry each other. A single uncle on one side must not be pushed past the
    // other family, which would cross the lines of both.
    let t = emptyTree();
    const person = (lastName: string, firstName: string, gender: 'male' | 'female') => ({
      lastName,
      firstName,
      gender,
    });
    const add = (name: string, gender: 'male' | 'female') => {
      let id: string;
      [t, id] = addPerson(t, person('X', name, gender));
      return id;
    };
    const couple = (a: string, b: string) => {
      const x = add(a, 'male');
      const y = add(b, 'female');
      [t] = linkPartners(t, x, y);
      return [x, y] as const;
    };
    const child = (parents: readonly [string, string], name: string, gender: 'male' | 'female') => {
      let id: string;
      [t, id] = addChild(t, parents[0], person('X', name, gender), parents[1]);
      return id;
    };
    const g1 = couple('G1', 'G1w');
    const g2 = couple('G2', 'G2w');
    const g3 = couple('G3', 'G3w');
    const g4 = couple('G4', 'G4w');
    const wifeA = child(g1, 'A wife', 'female');
    const husbandA = child(g2, 'A', 'male');
    child(g2, 'Uncle', 'male');
    const husbandB = child(g3, 'B', 'male');
    const wifeB = child(g4, 'B wife', 'female');
    [t] = linkPartners(t, wifeA, husbandA);
    [t] = linkPartners(t, husbandB, wifeB);
    const cousin = child([husbandA, wifeA], 'C1', 'male');
    child([husbandA, wifeA], 'C2', 'male');
    const bride = child([husbandB, wifeB], 'D1', 'female');
    child([husbandB, wifeB], 'D2', 'male');
    [t] = linkPartners(t, cousin, bride);
    child([cousin, bride], 'E', 'male');
    const layout = computeLayout(t);
    expect(countCrossings(t, layout)).toBe(0);
    expect(countIntrusions(t, layout)).toBe(0);
  });
});
