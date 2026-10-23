import { childrenOf, parentsOf, partnersOf, siblingsOf, type TreeIndex } from './graph';
import type { FamilyTree, Id, Union } from './types';

export interface FocusView {
  tree: FamilyTree;
  /** Persons shown whose parents, partners or children are partly hidden. */
  truncated: Set<Id>;
}

/**
 * The part of the tree around one person: ancestors up to `up` generations,
 * descendants down to `down` generations, plus partners and the person's
 * siblings. Keeps huge trees readable and makes layout cost independent of
 * total size.
 */
export function focusSubtree(tree: FamilyTree, index: TreeIndex, rootId: Id, up: number, down: number): FocusView {
  const include = new Set<Id>([rootId]);
  siblingsOf(tree, index, rootId).forEach((s) => include.add(s));

  let level = [rootId];
  for (let g = 0; g < up && level.length; g++) {
    level = level.flatMap((id) => parentsOf(tree, index, id));
    level.forEach((id) => include.add(id));
  }

  level = [rootId];
  for (let g = 0; g <= down && level.length; g++) {
    level.forEach((id) => partnersOf(tree, index, id).forEach((p) => include.add(p)));
    if (g === down) break;
    level = level.flatMap((id) => childrenOf(tree, index, id));
    level.forEach((id) => include.add(id));
  }

  const persons: FamilyTree['persons'] = {};
  include.forEach((id) => (persons[id] = tree.persons[id]));
  const unions: Record<Id, Union> = {};
  for (const u of Object.values(tree.unions)) {
    const partners = u.partners.filter((p) => include.has(p));
    if (!partners.length) continue;
    const children = u.children.filter((c) => include.has(c));
    if (partners.length === 1 && !children.length) continue;
    unions[u.id] = partners.length === u.partners.length && children.length === u.children.length ? u : { ...u, partners, children };
  }

  const truncated = new Set<Id>();
  for (const id of include) {
    const relatives = [...parentsOf(tree, index, id), ...partnersOf(tree, index, id), ...childrenOf(tree, index, id)];
    if (relatives.some((r) => !include.has(r))) truncated.add(id);
  }
  return { tree: { ...tree, persons, unions }, truncated };
}
