import { buildIndex, isAncestor } from './graph';
import { newId } from './id';
import { storiesOf, type FamilyTree, type Id, type Person, type PersonInput, type Story, type StoryInput, type Union } from './types';

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
  let stories = tree.stories;
  for (const st of Object.values(storiesOf(tree))) {
    if (!st.members.includes(id)) continue;
    if (stories === tree.stories) stories = { ...stories };
    stories![st.id] = { ...st, members: st.members.filter((m) => m !== id) };
  }
  return stories ? { ...tree, persons, unions, stories } : { ...tree, persons, unions };
}

// ---- Family history cards (stories) ----

function cleanStory(tree: FamilyTree, input: StoryInput): StoryInput {
  const title = input.title.trim();
  if (!title) throw new TreeError('A történetnek adj címet.');
  const members = [...new Set(input.members)];
  for (const m of members) requirePerson(tree, m);
  const result: StoryInput = { title, text: input.text, members };
  if (input.date?.trim()) result.date = input.date.trim();
  if (input.place?.trim()) result.place = input.place.trim();
  if (input.private) result.private = true;
  return result;
}

function withStory(tree: FamilyTree, story: Story): FamilyTree {
  return { ...tree, stories: { ...storiesOf(tree), [story.id]: story } };
}

export function addStory(tree: FamilyTree, input: StoryInput): [FamilyTree, Id] {
  const id = newId('s');
  return [withStory(tree, { ...cleanStory(tree, input), id }), id];
}

export function updateStory(tree: FamilyTree, id: Id, patch: Partial<StoryInput>): FamilyTree {
  const st = storiesOf(tree)[id];
  if (!st) throw new TreeError(`Ismeretlen történet: ${id}`);
  return withStory(tree, { ...cleanStory(tree, { ...st, ...patch }), id });
}

export function removeStory(tree: FamilyTree, id: Id): FamilyTree {
  if (!storiesOf(tree)[id]) return tree;
  const stories = { ...storiesOf(tree) };
  delete stories[id];
  return { ...tree, stories };
}

export function storiesWith(tree: FamilyTree, personId: Id): Story[] {
  return Object.values(storiesOf(tree)).filter((s) => s.members.includes(personId));
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

export function addChild(tree: FamilyTree, parent: Id, input: PersonInput, coParent?: Id): [FamilyTree, Id] {
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

function withoutUnion(tree: FamilyTree, id: Id): FamilyTree {
  const unions = { ...tree.unions };
  delete unions[id];
  return { ...tree, unions };
}

/** Saves a union, or drops it if it no longer records any relationship. */
function withUnionOrNone(tree: FamilyTree, union: Union): FamilyTree {
  const empty = union.partners.length === 0 || (union.partners.length === 1 && union.children.length === 0);
  return empty ? withoutUnion(tree, union.id) : withUnion(tree, union);
}

/** Places a child into the union of `parent` and `coParent`, or `parent`'s single-parent union. */
function placeChild(tree: FamilyTree, parent: Id, child: Id, coParent?: Id): FamilyTree {
  let unionId: Id | undefined;
  if (coParent) [tree, unionId] = linkPartners(tree, parent, coParent);
  else {
    unionId = (buildIndex(tree).partnerUnions.get(parent) ?? []).find((u) => tree.unions[u].partners.length === 1);
  }
  if (!unionId) {
    unionId = newId('u');
    tree = withUnion(tree, { id: unionId, partners: [parent], children: [] });
  }
  const u = tree.unions[unionId];
  return withUnion(tree, { ...u, children: [...u.children, child] });
}

/**
 * Removes `parent` as a parent of `child`. The other parent, if any, stays the
 * child's parent; the couple itself stays together.
 */
export function unlinkParent(tree: FamilyTree, child: Id, parent: Id): FamilyTree {
  requirePerson(tree, child);
  requirePerson(tree, parent);
  const unionId = buildIndex(tree).parentUnion.get(child);
  const u = unionId ? tree.unions[unionId] : undefined;
  if (!u || !u.partners.includes(parent)) throw new TreeError('Ez a személy nem szülője a gyermeknek.');
  tree = withUnionOrNone(tree, { ...u, children: u.children.filter((c) => c !== child) });
  const other = u.partners.find((p) => p !== parent);
  return other ? placeChild(tree, other, child) : tree;
}

/** Ends the partnership of two persons. Refused while they have children together. */
export function unlinkPartners(tree: FamilyTree, a: Id, b: Id): FamilyTree {
  requirePerson(tree, a);
  requirePerson(tree, b);
  const unionId = (buildIndex(tree).partnerUnions.get(a) ?? []).find((u) => tree.unions[u].partners.includes(b));
  if (!unionId) throw new TreeError('Ők ketten nincsenek párként összekötve.');
  if (tree.unions[unionId].children.length) {
    throw new TreeError('Közös gyermekeik vannak. Előbb a gyermekeknél módosítsd a másik szülőt.');
  }
  return withoutUnion(tree, unionId);
}

/**
 * Sets who the other parent of `parent`'s child is: one of `parent`'s partners,
 * or nobody (undefined).
 */
export function setOtherParent(tree: FamilyTree, parent: Id, child: Id, coParent?: Id): FamilyTree {
  requirePerson(tree, parent);
  requirePerson(tree, child);
  const unionId = buildIndex(tree).parentUnion.get(child);
  const u = unionId ? tree.unions[unionId] : undefined;
  if (!u || !u.partners.includes(parent)) throw new TreeError('Ez a személy nem szülője a gyermeknek.');
  if (coParent === parent) throw new TreeError('Valaki nem lehet önmaga párja.');
  if (coParent && (coParent === child || isAncestor(tree, buildIndex(tree), child, coParent))) {
    throw new TreeError('A kapcsolat körkörös leszármazást hozna létre.');
  }
  const current = u.partners.find((p) => p !== parent);
  if (current === coParent) return tree;
  tree = withUnionOrNone(tree, { ...u, children: u.children.filter((c) => c !== child) });
  return placeChild(tree, parent, child, coParent);
}
