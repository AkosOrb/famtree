import { childrenOf, parentsOf, partnersOf, type TreeIndex } from './graph';
import type { FamilyTree, Gender, Id } from './types';

export type Relation = 'parent' | 'child' | 'partner';

/** One hop of a path: `id` is the `relation` of the previous person. */
export interface PathStep {
  id: Id;
  relation: Relation | null; // null for the starting person
}

/**
 * Shortest chain of parent / child / partner links between two people
 * (breadth-first search, so O(people + relationships)). Returns null if they
 * are not connected.
 */
export function findPath(tree: FamilyTree, index: TreeIndex, from: Id, to: Id): PathStep[] | null {
  if (!tree.persons[from] || !tree.persons[to]) return null;
  const prev = new Map<Id, { from: Id; relation: Relation } | null>([[from, null]]);
  const queue = [from];
  for (let i = 0; i < queue.length && !prev.has(to); i++) {
    const cur = queue[i];
    const visit = (ids: Id[], relation: Relation) => {
      for (const id of ids) {
        if (!prev.has(id)) {
          prev.set(id, { from: cur, relation });
          queue.push(id);
        }
      }
    };
    // Blood links first, so ties prefer them over in-law links.
    visit(parentsOf(tree, index, cur), 'parent');
    visit(childrenOf(tree, index, cur), 'child');
    visit(partnersOf(tree, index, cur), 'partner');
  }
  if (!prev.has(to)) return null;
  const steps: PathStep[] = [];
  for (let id: Id | undefined = to; id !== undefined; ) {
    const p = prev.get(id);
    steps.push({ id, relation: p?.relation ?? null });
    id = p?.from;
  }
  return steps.reverse();
}

const byGender = (g: Gender, male: string, female: string, neutral: string) =>
  g === 'male' ? male : g === 'female' ? female : neutral;

/** "apja", "felesége", "lánya"…: what `id` is to the previous person. */
export function relationWord(relation: Relation, gender: Gender): string {
  if (relation === 'parent') return byGender(gender, 'apja', 'anyja', 'szülője');
  if (relation === 'child') return byGender(gender, 'fia', 'lánya', 'gyermeke');
  return byGender(gender, 'férje', 'felesége', 'párja');
}

const great = (n: number) => (n <= 0 ? '' : n === 1 ? 'déd' : n === 2 ? 'ük' : n === 3 ? 'szép' : `${n}. fokú déd`);

/**
 * Hungarian kinship term for what the last person of the path is to the first
 * ("unokája", "nagynénje", "apósa"…). Covers blood lines (up to a common
 * ancestor, then down) and the common in-law cases; returns null otherwise,
 * in which case the step list speaks for itself.
 */
export function kinshipTerm(tree: FamilyTree, path: PathStep[]): string | null {
  if (path.length < 2) return null;
  const first = tree.persons[path[0].id];
  const target = tree.persons[path[path.length - 1].id];
  const g = target.gender;
  const rels = path
    .slice(1)
    .map((s) => s.relation!)
    .join(' ');

  switch (rels) {
    case 'partner':
      return byGender(g, 'férje', 'felesége', 'párja');
    case 'child partner':
      return byGender(g, 'veje', 'menye', 'gyermeke párja');
    case 'partner parent':
      return byGender(g, 'apósa', 'anyósa', 'apósa / anyósa');
    case 'partner child':
      return byGender(g, 'mostohafia', 'mostohalánya', 'mostohagyermeke');
    case 'parent partner':
      return byGender(g, 'mostohaapja', 'mostohaanyja', 'mostohaszülője');
    case 'partner parent child':
    case 'parent child partner':
      return byGender(g, 'sógora', 'sógornője', 'sógora / sógornője');
  }

  const steps = rels.split(' ');
  let up = 0;
  while (up < steps.length && steps[up] === 'parent') up++;
  let down = 0;
  while (up + down < steps.length && steps[up + down] === 'child') down++;
  if (up + down !== steps.length) return null;

  if (down === 0) {
    if (up === 1) return byGender(g, 'apja', 'anyja', 'szülője');
    return great(up - 2) + byGender(g, 'nagyapja', 'nagyanyja', 'nagyszülője');
  }
  if (up === 0) {
    if (down === 1) return byGender(g, 'fia', 'lánya', 'gyermeke');
    return `${great(down - 2)}unokája`;
  }
  if (up === 1 && down === 1) {
    const older = target.birthYear != null && first.birthYear != null ? target.birthYear < first.birthYear : undefined;
    if (older === undefined) return byGender(g, 'fivére', 'nőtestvére', 'testvére');
    return older ? byGender(g, 'bátyja', 'nővére', 'testvére') : byGender(g, 'öccse', 'húga', 'testvére');
  }
  if (up === 2 && down === 1) return byGender(g, 'nagybátyja', 'nagynénje', 'nagybátyja / nagynénje');
  if (up === 1 && down === 2) return byGender(g, 'unokaöccse', 'unokahúga', 'unokaöccse / unokahúga');
  if (up === down) return up === 2 ? 'unokatestvére' : `${up - 1}. fokú unokatestvére`;
  // Other collateral relatives: the civil-law degree counts every generation step.
  return `${up + down}. fokú oldalági rokona`;
}
