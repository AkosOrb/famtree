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
