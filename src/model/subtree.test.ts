import { describe, expect, it } from 'vitest';
import { buildIndex } from './graph';
import { generateTree, inLawTree, sampleTree } from './sample';
import { computeLayout } from '../layout/layout';
import { familyNames, familySubtree, focusSubtree, lineageSubtree } from './subtree';
import { fullName } from './types';

describe('focusSubtree', () => {
  it('keeps ancestors, descendants, partners and siblings around the focus person', () => {
    const t = sampleTree();
    const index = buildIndex(t);
    const istvan = Object.values(t.persons).find((p) => fullName(p) === 'Kovács István')!.id;
    const view = focusSubtree(t, index, istvan, 1, 1);
    const names = Object.values(view.tree.persons).map(fullName).sort();
    expect(names).toEqual(
      [
        'Kovács János',
        'Szabó Mária',
        'Kovács István',
        'Tóth Éva',
        'Kovács Katalin',
        'Kovács Ferenc',
        'Kovács Gábor',
        'Horváth Lilla',
        'Kovács Zsófia',
      ].sort(),
    );
    // Gábor and Lilla have a hidden child, Katalin a hidden partner.
    const truncated = [...view.truncated].map((id) => fullName(t.persons[id])).sort();
    expect(truncated).toEqual(['Horváth Lilla', 'Kovács Gábor', 'Kovács Katalin']);
    for (const u of Object.values(view.tree.unions)) {
      [...u.partners, ...u.children].forEach((id) => expect(view.tree.persons[id]).toBeDefined());
    }
  });

  it('stays small inside a large tree', () => {
    const t = generateTree(5000);
    const root = Object.keys(t.persons)[100];
    const view = focusSubtree(t, buildIndex(t), root, 3, 3);
    expect(Object.keys(view.tree.persons).length).toBeLessThan(200);
  });
});

describe('lineageSubtree', () => {
  const t = inLawTree();
  const index = buildIndex(t);
  const id = (name: string) => Object.values(t.persons).find((p) => fullName(p) === name)!.id;
  const names = (v: { tree: { persons: Record<string, Parameters<typeof fullName>[0]> } }) =>
    Object.values(v.tree.persons).map(fullName).sort();

  it('shows only the direct ancestors in the ancestor view', () => {
    const view = lineageSubtree(t, index, id('Kovács Gábor'), 'ancestors', Infinity);
    expect(names(view)).toEqual(
      [
        'Kovács Gábor',
        'Kovács István',
        'Tóth Éva',
        'Kovács János',
        'Szabó Mária',
        'Tóth Sándor',
        'Farkas Ilona',
      ].sort(),
    );
    // No ⊕ for siblings or children left out on purpose.
    expect(view.truncated.size).toBe(0);
    const limited = lineageSubtree(t, index, id('Kovács Gábor'), 'ancestors', 1);
    expect(names(limited)).toEqual(['Kovács Gábor', 'Kovács István', 'Tóth Éva'].sort());
    expect([...limited.truncated].map((x) => fullName(t.persons[x])).sort()).toEqual(['Kovács István', 'Tóth Éva']);
  });

  it('shows descendants with their partners in the descendant view', () => {
    const view = lineageSubtree(t, index, id('Kovács István'), 'descendants', Infinity);
    expect(names(view)).toEqual(
      ['Kovács István', 'Tóth Éva', 'Kovács Gábor', 'Horváth Lilla', 'Kovács Zsófia', 'Kovács Máté'].sort(),
    );
    expect(view.truncated.size).toBe(0);
  });

  it('combines both directions without siblings in the hourglass view', () => {
    // Like the "around" view, the last generation keeps its partners (Lilla), but István's sister Katalin is left out.
    const view = lineageSubtree(t, index, id('Kovács István'), 'hourglass', 1);
    expect(names(view)).toEqual(
      [
        'Kovács István',
        'Tóth Éva',
        'Kovács János',
        'Szabó Mária',
        'Kovács Gábor',
        'Horváth Lilla',
        'Kovács Zsófia',
      ].sort(),
    );
    for (const u of Object.values(view.tree.unions)) {
      [...u.partners, ...u.children].forEach((p) => expect(view.tree.persons[p]).toBeDefined());
    }
  });
});

describe('familySubtree', () => {
  it('shows everyone with the family name and their partners, and flags hidden relatives', () => {
    const t = inLawTree();
    expect(familyNames(t)[0]).toEqual({ name: 'Kovács', count: 7 });
    const view = familySubtree(t, buildIndex(t), ['Kovács']);
    expect(view.common.size).toBe(0);
    const names = Object.values(view.tree.persons).map(fullName).sort();
    expect(names).toEqual(
      [
        'Horváth Lilla',
        'Kovács Ferenc',
        'Kovács Gábor',
        'Kovács István',
        'Kovács János',
        'Kovács Katalin',
        'Kovács Máté',
        'Kovács Zsófia',
        'Nagy Péter',
        'Szabó Mária',
        'Tóth Éva',
      ].sort((a, b) => a.localeCompare(b)),
    );
    const byName = (n: string) => Object.values(t.persons).find((p) => fullName(p) === n)!.id;
    // Katalin's children are Nagys; Éva's parents are outside the family.
    expect(view.truncated.has(byName('Kovács Katalin'))).toBe(true);
    expect(view.truncated.has(byName('Tóth Éva'))).toBe(true);
    expect(view.truncated.has(byName('Kovács Ferenc'))).toBe(false);
    for (const u of Object.values(view.tree.unions)) {
      [...u.partners, ...u.children].forEach((p) => expect(view.tree.persons[p]).toBeDefined());
    }
  });

  it('shows several families together and finds the people they share', () => {
    const t = inLawTree();
    const view = familySubtree(t, buildIndex(t), ['Kovács', 'Tóth', 'Nagy']);
    const names = (ids: Iterable<string>) => [...ids].map((id) => fullName(t.persons[id])).sort();
    // The couples linking the families: Éva (a Tóth) and István, Katalin and Péter (a Nagy).
    expect(names(view.common)).toEqual(['Kovács István', 'Kovács Katalin', 'Nagy Péter', 'Tóth Éva'].sort());
    for (const name of ['Tóth Sándor', 'Nagy Bence', 'Nagy Anna', 'Kovács Máté']) {
      expect(names(Object.keys(view.tree.persons))).toContain(name);
    }
  });
});

describe('families side by side', () => {
  it('keeps every family on its own side of the couples joining them', () => {
    const t = inLawTree();
    const view = familySubtree(t, buildIndex(t), ['Kovács', 'Tóth', 'Nagy']);
    const layout = computeLayout(view.tree, undefined, view.sides);
    const rows = new Map<number, { x: number; side: number }[]>();
    for (const box of layout.persons.values()) {
      const row = rows.get(box.y) ?? [];
      row.push({ x: box.x, side: view.sides.get(box.id)! });
      rows.set(box.y, row);
    }
    for (const row of rows.values()) {
      const sides = row.sort((a, b) => a.x - b.x).map((r) => r.side);
      expect(sides).toEqual([...sides].sort((a, b) => a - b));
    }
    // Families joined by a couple stand next to each other: Tóth and Nagy both meet the Kovács family.
    const side = (name: string) => view.sides.get(Object.values(t.persons).find((p) => p.lastName === name)!.id)!;
    expect(side('Kovács')).toBe(1);
    expect(Math.abs(side('Tóth') - side('Nagy'))).toBe(2);
  });

  it('keeps large generated families apart in every row', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const t = generateTree(500, seed, 0.5);
      const names = familyNames(t)
        .slice(0, 3)
        .map((f) => f.name);
      const view = familySubtree(t, buildIndex(t), names);
      const layout = computeLayout(view.tree, undefined, view.sides);
      const x = (id: string) => layout.persons.get(id)!.x;
      // Only the couples joining two families stand between them (several such
      // couples in one row may interleave); everyone else keeps to their side.
      const rows = new Map<number, { x: number; side: number }[]>();
      for (const box of layout.persons.values()) {
        if (view.common.has(box.id)) continue;
        const row = rows.get(box.y) ?? [];
        row.push({ x: box.x, side: view.sides.get(box.id)! });
        rows.set(box.y, row);
      }
      for (const row of rows.values()) {
        const sides = row.sort((a, b) => a.x - b.x).map((r) => r.side);
        expect(sides).toEqual([...sides].sort((a, b) => a - b));
      }
      // Each partner of such a couple stands on their own family's side.
      for (const u of Object.values(view.tree.unions)) {
        const [a, b] = u.partners;
        if (b === undefined || layout.persons.get(a)!.y !== layout.persons.get(b)!.y) continue;
        const [sa, sb] = [view.sides.get(a)!, view.sides.get(b)!];
        if (sa !== sb) expect(Math.sign(x(b) - x(a))).toBe(Math.sign(sb - sa));
      }
    }
  });
});
