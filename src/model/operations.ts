import { buildIndex, isAncestor } from './graph';
import { newId } from './id';
import type { FamilyTree, Id, Person, PersonInput, Union } from './types';

/**
 * Pure, immutable edits of a FamilyTree. Every function returns a new tree
 * (structural sharing for untouched records) and throws TreeError on
 * operations that would make the graph inconsistent.
 */

export class TreeError extends Error {}

function withPerson(tree: FamilyTree, person: Person): FamilyTree {
  return { ...tree, persons: { ...tree.persons, [person.id]: person } };
}

function withUnion(tree: FamilyTree, union: Union): FamilyTree {
  return { ...tree, unions: { ...tree.unions, [union.id]: union } };
}

function requirePerson(tree: FamilyTree, id: Id): Person {
  const p = tree.persons[id];
  if (!p) throw new TreeError(`Ismeretlen személy: ${id}`);
  return p;
}

export function addPerson(tree: FamilyTree, input: PersonInput): [FamilyTree, Id] {
  const id = newId('p');
  return [withPerson(tree, { ...input, id }), id];
}

export function updatePerson(tree: FamilyTree, id: Id, patch: Partial<PersonInput>): FamilyTree {
  const p = requirePerson(tree, id);
  return withPerson(tree, { ...p, ...patch, id });
}

export function removePerson(tree: FamilyTree, id: Id): FamilyTree {
  requirePerson(tree, id);
  const persons = { ...tree.persons };
  delete persons[id];
  const unions: Record<Id, Union> = {};
  for (const u of Object.values(tree.unions)) {
    if (!u.partners.includes(id) && !u.children.includes(id)) {
      unions[u.id] = u;
      continue;
    }
    const next = {
      ...u,
      partners: u.partners.filter((p) => p !== id),
      children: u.children.filter((c) => c !== id),
    };
    // A union without partners, or a lone partner without children, carries no relationship.
    if (next.partners.length === 0) continue;
    if (next.partners.length === 1 && next.children.length === 0) continue;
    unions[next.id] = next;
  }
  return { ...tree, persons, unions };
}

/** Links two existing persons as partners (no-op if they already are). */
export function linkPartners(tree: FamilyTree, a: Id, b: Id): [FamilyTree, Id] {
  requirePerson(tree, a);
  requirePerson(tree, b);
  if (a === b) throw new TreeError('Valaki nem lehet önmaga párja.');
  const index = buildIndex(tree);
  if (isAncestor(tree, index, a, b) || isAncestor(tree, index, b, a)) {
    throw new TreeError('Felmenő és leszármazott nem köthető össze párként.');
  }
  const existing = (index.partnerUnions.get(a) ?? []).find((u) => tree.unions[u].partners.includes(b));
  if (existing) return [tree, existing];
  // Fill a single-parent union of either person before creating a new one.
  for (const [single, other] of [
    [a, b],
    [b, a],
  ]) {
    const solo = (index.partnerUnions.get(single) ?? []).find((u) => tree.unions[u].partners.length === 1);
    if (solo) {
      const u = tree.unions[solo];
      return [withUnion(tree, { ...u, partners: [...u.partners, other] }), solo];
    }
  }
  const id = newId('u');
  return [withUnion(tree, { id, partners: [a, b], children: [] }), id];
}

/**
 * Links an existing child to an existing parent. If `coParent` is given the
 * child is placed in the union of the two; otherwise into the parent's only
 * union, or a new single-parent union.
 */
export function linkChild(tree: FamilyTree, parent: Id, child: Id, coParent?: Id): FamilyTree {
  requirePerson(tree, parent);
  requirePerson(tree, child);
  if (parent === child) throw new TreeError('Valaki nem lehet önmaga gyermeke.');
  const index = buildIndex(tree);
  if (index.parentUnion.has(child)) throw new TreeError('Ennek a személynek már vannak szülei rögzítve.');
  if (isAncestor(tree, index, child, parent)) {
    throw new TreeError('A kapcsolat körkörös leszármazást hozna létre.');
  }
  let unionId: Id | undefined;
  if (coParent) {
    [tree, unionId] = linkPartners(tree, parent, coParent);
  } else {
    const own = index.partnerUnions.get(parent) ?? [];
    if (own.length === 1) unionId = own[0];
  }
  if (!unionId) {
    unionId = newId('u');
    tree = withUnion(tree, { id: unionId, partners: [parent], children: [] });
  }
  const u = tree.unions[unionId];
  return withUnion(tree, { ...u, children: [...u.children, child] });
}

/** Adds a parent to an existing person (max. two parents). */
export function linkParent(tree: FamilyTree, child: Id, parent: Id): FamilyTree {
  requirePerson(tree, child);
  requirePerson(tree, parent);
  const index = buildIndex(tree);
  const unionId = index.parentUnion.get(child);
  if (!unionId) return linkChild(tree, parent, child);
  const u = tree.unions[unionId];
  if (u.partners.includes(parent)) return tree;
  if (u.partners.length >= 2) throw new TreeError('Ennek a személynek már két szülője van.');
  if (parent === child || isAncestor(tree, index, child, parent)) {
    throw new TreeError('A kapcsolat körkörös leszármazást hozna létre.');
  }
  if (isAncestor(tree, index, parent, u.partners[0]) || isAncestor(tree, index, u.partners[0], parent)) {
    throw new TreeError('Felmenő és leszármazott nem köthető össze párként.');
  }
  return withUnion(tree, { ...u, partners: [...u.partners, parent] });
}

export function addChild(
  tree: FamilyTree,
  parent: Id,
  input: PersonInput,
  coParent?: Id,
): [FamilyTree, Id] {
  const [t, id] = addPerson(tree, input);
  return [linkChild(t, parent, id, coParent), id];
}

export function addPartner(tree: FamilyTree, person: Id, input: PersonInput): [FamilyTree, Id] {
  const [t, id] = addPerson(tree, input);
  return [linkPartners(t, person, id)[0], id];
}

export function addParent(tree: FamilyTree, child: Id, input: PersonInput): [FamilyTree, Id] {
  const index = buildIndex(tree);
  const u = index.parentUnion.get(child);
  if (u && tree.unions[u].partners.length >= 2) {
    throw new TreeError('Ennek a személynek már két szülője van.');
  }
  const [t, id] = addPerson(tree, input);
  return [linkParent(t, child, id), id];
}
