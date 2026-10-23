import type { FamilyTree } from '../model/types';
import type { Layout } from './layout';

/**
 * Number of crossing parent→child lines between adjacent generations, with each
 * line drawn from the parents' union point to the child. Used by tests to keep
 * layout changes honest.
 */
export function countCrossings(tree: FamilyTree, layout: Layout): number {
  const byRow = new Map<number, [number, number][]>();
  for (const u of layout.unions) {
    for (const c of u.children) {
      const child = layout.persons.get(c);
      if (!child) continue;
      const row = byRow.get(child.y) ?? [];
      row.push([u.x, child.x]);
      byRow.set(child.y, row);
    }
  }
  let crossings = 0;
  for (const edges of byRow.values()) {
    for (let i = 0; i < edges.length; i++) {
      for (let j = i + 1; j < edges.length; j++) {
        const [a1, b1] = edges[i];
        const [a2, b2] = edges[j];
        if ((a1 - a2) * (b1 - b2) < 0) crossings++;
      }
    }
  }
  void tree;
  return crossings;
}

/**
 * Number of cards that a sibling line runs over although they are neither one
 * of those siblings nor married to one of them, so the drawing suggests a
 * relationship that does not exist.
 */
export function countIntrusions(tree: FamilyTree, layout: Layout): number {
  const rows = new Map<number, { id: string; x: number }[]>();
  for (const p of layout.persons.values()) {
    const row = rows.get(p.y) ?? [];
    row.push(p);
    rows.set(p.y, row);
  }
  let intrusions = 0;
  for (const u of layout.unions) {
    const kids = u.children.map((c) => layout.persons.get(c)).filter((k) => !!k);
    if (kids.length < 2) continue;
    const family = new Set(u.children);
    for (const other of Object.values(tree.unions)) {
      if (other.partners.some((p) => family.has(p))) other.partners.forEach((p) => family.add(p));
    }
    const lo = Math.min(...kids.map((k) => k.x));
    const hi = Math.max(...kids.map((k) => k.x));
    for (const p of rows.get(kids[0].y) ?? []) if (p.x > lo && p.x < hi && !family.has(p.id)) intrusions++;
  }
  return intrusions;
}
