import { childrenOf, parentsOf, partnersOf, siblingsOf, type TreeIndex } from './graph';
import type { FamilyTree, Id, Union } from './types';

export interface FocusView {
  tree: FamilyTree;
  /** Persons shown whose parents, partners or children are partly hidden. */
  truncated: Set<Id>;
}

/**
 * Which part of the tree a focused view shows around its root person:
 * - around: ancestors, descendants, partners and the root's siblings,
 * - ancestors: only the direct line upwards (pedigree),
 * - descendants: children, grandchildren… with their partners,
 * - hourglass: ancestors and descendants, without siblings.
 */
export type LineageMode = 'around' | 'ancestors' | 'descendants' | 'hourglass';

/** Ancestors of `rootId` up to `generations` levels (Infinity for all), deduplicated. */
function collectAncestors(tree: FamilyTree, index: TreeIndex, rootId: Id, generations: number, into: Set<Id>) {
  let level = [rootId];
  for (let g = 0; g < generations && level.length; g++) {
    level = level.flatMap((id) => parentsOf(tree, index, id)).filter((id) => !into.has(id));
    level.forEach((id) => into.add(id));
  }
}

/** Descendants up to `generations` levels, plus the partners of everyone on the way. */
function collectDescendants(tree: FamilyTree, index: TreeIndex, rootId: Id, generations: number, into: Set<Id>) {
  let level = [rootId];
  for (let g = 0; level.length; g++) {
    level.forEach((id) => partnersOf(tree, index, id).forEach((p) => into.add(p)));
    if (g >= generations) break;
    level = level.flatMap((id) => childrenOf(tree, index, id)).filter((id) => !into.has(id));
    level.forEach((id) => into.add(id));
  }
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
  collectAncestors(tree, index, rootId, up, include);
  collectDescendants(tree, index, rootId, down, include);
  return buildView(tree, include, (id) => [
    ...parentsOf(tree, index, id),
    ...partnersOf(tree, index, id),
    ...childrenOf(tree, index, id),
  ]);
}

/**
 * A focused view in one of the lineage modes. In the pure ancestor and
 * descendant views the ⊕ marker only flags relatives hidden in the view's own
 * direction (parents beyond the depth limit, or children beyond it), since
 * everyone else's siblings and in-laws are left out on purpose.
 */
export function lineageSubtree(
  tree: FamilyTree,
  index: TreeIndex,
  rootId: Id,
  mode: LineageMode,
  generations: number,
): FocusView {
  if (mode === 'around') return focusSubtree(tree, index, rootId, generations, generations);
  const include = new Set<Id>([rootId]);
  const ancestors = new Set<Id>();
  if (mode !== 'descendants') collectAncestors(tree, index, rootId, generations, ancestors);
  ancestors.forEach((id) => include.add(id));
  const descendants = new Set<Id>([rootId]);
  if (mode !== 'ancestors') collectDescendants(tree, index, rootId, generations, descendants);
  descendants.forEach((id) => include.add(id));
  return buildView(tree, include, (id) => {
    const up = mode !== 'descendants' && (id === rootId || ancestors.has(id)) ? parentsOf(tree, index, id) : [];
    const down = descendants.has(id) && mode !== 'ancestors' ? childrenOf(tree, index, id) : [];
    return [...up, ...down];
  });
}

function buildView(tree: FamilyTree, include: Set<Id>, relatives: (id: Id) => Id[]): FocusView {
  const persons: FamilyTree['persons'] = {};
  include.forEach((id) => (persons[id] = tree.persons[id]));
  const unions: Record<Id, Union> = {};
  for (const u of Object.values(tree.unions)) {
    const partners = u.partners.filter((p) => include.has(p));
    if (!partners.length) continue;
    const children = u.children.filter((c) => include.has(c));
    if (partners.length === 1 && !children.length) continue;
    unions[u.id] =
      partners.length === u.partners.length && children.length === u.children.length ? u : { ...u, partners, children };
  }

  const truncated = new Set<Id>();
  for (const id of include) if (relatives(id).some((r) => !include.has(r))) truncated.add(id);
  return { tree: { ...tree, persons, unions }, truncated };
}

/** Family names in the tree with how many people bear each, the largest family first. */
export function familyNames(tree: FamilyTree): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const p of Object.values(tree.persons)) {
    const name = p.lastName.trim();
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'hu'));
}

/**
 * One family: everyone who bears the family name, and their partners, who
 * married into the family. Relatives outside it (the in-laws' parents, the
 * children of daughters who took another name) are hidden and flagged.
 */
export function familySubtree(tree: FamilyTree, index: TreeIndex, name: string): FocusView {
  const include = new Set<Id>();
  for (const p of Object.values(tree.persons)) if (p.lastName.trim() === name) include.add(p.id);
  for (const id of [...include]) partnersOf(tree, index, id).forEach((p) => include.add(p));
  return buildView(tree, include, (id) => [
    ...parentsOf(tree, index, id),
    ...partnersOf(tree, index, id),
    ...childrenOf(tree, index, id),
  ]);
}
