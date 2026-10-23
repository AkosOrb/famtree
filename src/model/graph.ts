import type { FamilyTree, Id } from './types';

/** Reverse lookups, built in O(persons + unions). */
export interface TreeIndex {
  /** Unions in which the person is a partner. */
  partnerUnions: Map<Id, Id[]>;
  /** The union the person was born into (at most one). */
  parentUnion: Map<Id, Id>;
}

export function buildIndex(tree: FamilyTree): TreeIndex {
  const partnerUnions = new Map<Id, Id[]>();
  const parentUnion = new Map<Id, Id>();
  for (const union of Object.values(tree.unions)) {
    for (const p of union.partners) {
      const list = partnerUnions.get(p);
      if (list) list.push(union.id);
      else partnerUnions.set(p, [union.id]);
    }
    for (const c of union.children) parentUnion.set(c, union.id);
  }
  return { partnerUnions, parentUnion };
}

export function parentsOf(tree: FamilyTree, index: TreeIndex, id: Id): Id[] {
  const u = index.parentUnion.get(id);
  return u ? tree.unions[u].partners : [];
}

export function partnersOf(tree: FamilyTree, index: TreeIndex, id: Id): Id[] {
  const result: Id[] = [];
  for (const u of index.partnerUnions.get(id) ?? []) {
    for (const p of tree.unions[u].partners) if (p !== id) result.push(p);
  }
  return result;
}

export function childrenOf(tree: FamilyTree, index: TreeIndex, id: Id): Id[] {
  const result: Id[] = [];
  for (const u of index.partnerUnions.get(id) ?? []) result.push(...tree.unions[u].children);
  return result;
}

export function siblingsOf(tree: FamilyTree, index: TreeIndex, id: Id): Id[] {
  const u = index.parentUnion.get(id);
  return u ? tree.unions[u].children.filter((c) => c !== id) : [];
}

/** True if `ancestor` can be reached from `id` by walking up parent links. */
export function isAncestor(tree: FamilyTree, index: TreeIndex, ancestor: Id, id: Id): boolean {
  const stack = [id];
  const seen = new Set<Id>();
  while (stack.length) {
    const cur = stack.pop()!;
    for (const p of parentsOf(tree, index, cur)) {
      if (p === ancestor) return true;
      if (!seen.has(p)) {
        seen.add(p);
        stack.push(p);
      }
    }
  }
  return false;
}
