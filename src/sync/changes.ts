import type { FamilyTree, Gender, Id, Person, Union } from '../model/types';

/**
 * Record-level change set, shared by client and server. Trees are immutable,
 * so diffing two snapshots is a cheap reference comparison per record and the
 * payload stays proportional to what was edited, not to the tree size.
 */
export type Change =
  | { kind: 'person'; id: Id; value: Person | null }
  | { kind: 'union'; id: Id; value: Union | null };

export function diffTrees(from: FamilyTree, to: FamilyTree): Change[] {
  const changes: Change[] = [];
  const diff = <T,>(kind: 'person' | 'union', a: Record<Id, T>, b: Record<Id, T>) => {
    if (a === b) return;
    for (const id in b) if (a[id] !== b[id]) changes.push({ kind, id, value: b[id] } as Change);
    for (const id in a) if (!(id in b)) changes.push({ kind, id, value: null } as Change);
  };
  diff('person', from.persons, to.persons);
  diff('union', from.unions, to.unions);
  return changes;
}

export function applyChanges(tree: FamilyTree, changes: Change[]): FamilyTree {
  if (!changes.length) return tree;
  const persons = { ...tree.persons };
  const unions = { ...tree.unions };
  for (const c of changes) {
    const target: Record<Id, unknown> = c.kind === 'person' ? persons : unions;
    if (c.value) target[c.id] = c.value;
    else delete target[c.id];
  }
  return { ...tree, persons, unions };
}

const GENDERS: Gender[] = ['male', 'female', 'other', 'unknown'];
const isStr = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length <= max;
const isYear = (v: unknown) => v === undefined || (Number.isInteger(v) && Math.abs(v as number) < 10000);
const isIdList = (v: unknown, min: number, max: number) =>
  Array.isArray(v) && v.length >= min && v.length <= max && v.every((x) => isStr(x, 64));

/** Structural validation of untrusted change payloads (server side). */
export function isValidChange(c: unknown): c is Change {
  if (!c || typeof c !== 'object') return false;
  const { kind, id, value } = c as Record<string, unknown>;
  if (!isStr(id, 64) || !id) return false;
  if (value === null) return kind === 'person' || kind === 'union';
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.id !== id) return false;
  if (kind === 'person') {
    return (
      isStr(v.firstName) &&
      isStr(v.lastName) &&
      GENDERS.includes(v.gender as Gender) &&
      isYear(v.birthYear) &&
      isYear(v.deathYear) &&
      (v.notes === undefined || isStr(v.notes, 10000))
    );
  }
  if (kind === 'union') return isIdList(v.partners, 1, 2) && isIdList(v.children, 0, 500);
  return false;
}
