import { isPhotoDataUrl } from '../model/photo';
import { storiesOf, type FamilyTree, type Gender, type Id, type Person, type Story, type Union } from '../model/types';

/**
 * Record-level change set, shared by client and server. Trees are immutable,
 * so diffing two snapshots is a cheap reference comparison per record and the
 * payload stays proportional to what was edited, not to the tree size.
 */
export type Change =
  | { kind: 'person'; id: Id; value: Person | null }
  | { kind: 'union'; id: Id; value: Union | null }
  | { kind: 'story'; id: Id; value: Story | null };

type Kind = Change['kind'];
const KINDS: Kind[] = ['person', 'union', 'story'];

export function diffTrees(from: FamilyTree, to: FamilyTree): Change[] {
  const changes: Change[] = [];
  const diff = <T>(kind: Kind, a: Record<Id, T>, b: Record<Id, T>) => {
    if (a === b) return;
    for (const id in b) if (a[id] !== b[id]) changes.push({ kind, id, value: b[id] } as Change);
    for (const id in a) if (!(id in b)) changes.push({ kind, id, value: null } as Change);
  };
  diff('person', from.persons, to.persons);
  diff('union', from.unions, to.unions);
  if (from.stories !== to.stories) diff('story', storiesOf(from), storiesOf(to));
  return changes;
}

export function applyChanges(tree: FamilyTree, changes: Change[]): FamilyTree {
  if (!changes.length) return tree;
  const persons = { ...tree.persons };
  const unions = { ...tree.unions };
  const stories = { ...storiesOf(tree) };
  const targets: Record<Kind, Record<Id, unknown>> = { person: persons, union: unions, story: stories };
  for (const c of changes) {
    const target = targets[c.kind];
    if (c.value) target[c.id] = c.value;
    else delete target[c.id];
  }
  // Trees without stories stay without the field.
  if (!tree.stories && !changes.some((c) => c.kind === 'story')) return { ...tree, persons, unions };
  return { ...tree, persons, unions, stories };
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
  if (value === null) return KINDS.includes(kind as Kind);
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
      (v.notes === undefined || isStr(v.notes, 10000)) &&
      (v.photo === undefined || isPhotoDataUrl(v.photo)) &&
      (v.private === undefined || typeof v.private === 'boolean')
    );
  }
  if (kind === 'union') return isIdList(v.partners, 1, 2) && isIdList(v.children, 0, 500);
  if (kind === 'story') {
    return (
      isStr(v.title) &&
      !!(v.title as string).trim() &&
      (v.date === undefined || isStr(v.date, 100)) &&
      (v.place === undefined || isStr(v.place)) &&
      isStr(v.text, 20000) &&
      isIdList(v.members, 0, 1000) &&
      (v.private === undefined || typeof v.private === 'boolean')
    );
  }
  return false;
}

const PERSON_FIELDS = ['id', 'firstName', 'lastName', 'gender', 'birthYear', 'deathYear', 'notes', 'photo', 'private'];
const UNION_FIELDS = ['id', 'partners', 'children'];
const STORY_FIELDS = ['id', 'title', 'date', 'place', 'text', 'members', 'private'];
const FIELDS: Record<Kind, string[]> = { person: PERSON_FIELDS, union: UNION_FIELDS, story: STORY_FIELDS };

/**
 * Keeps only known fields of a validated change, so clients cannot store
 * arbitrary extra data (or a forged `redacted` flag) on the server.
 */
export function sanitizeChange(c: Change): Change {
  if (!c.value) return { kind: c.kind, id: c.id, value: null } as Change;
  const value: Record<string, unknown> = {};
  for (const k of FIELDS[c.kind]) {
    const v = (c.value as unknown as Record<string, unknown>)[k];
    if (v !== undefined) value[k] = v;
  }
  return { kind: c.kind, id: c.id, value } as unknown as Change;
}

/** Validates a whole tree (an upload or an imported file) record by record. */
export function isValidTree(t: unknown): t is FamilyTree {
  if (!t || typeof t !== 'object') return false;
  const tree = t as Partial<FamilyTree>;
  if (tree.version !== 1 || !tree.persons || !tree.unions) return false;
  if (typeof tree.persons !== 'object' || typeof tree.unions !== 'object') return false;
  if (tree.stories !== undefined && (!tree.stories || typeof tree.stories !== 'object')) return false;
  return (
    Object.entries(tree.persons).every(([id, value]) => isValidChange({ kind: 'person', id, value })) &&
    Object.entries(tree.unions).every(([id, value]) => isValidChange({ kind: 'union', id, value })) &&
    Object.entries(tree.stories ?? {}).every(([id, value]) => isValidChange({ kind: 'story', id, value }))
  );
}

/** Applies sanitizeChange to every record of a validated tree. */
export function sanitizeTree(tree: FamilyTree): FamilyTree {
  const changes = diffTrees({ version: 1, persons: {}, unions: {} }, tree).map(sanitizeChange);
  return applyChanges({ version: 1, persons: {}, unions: {} }, changes);
}
