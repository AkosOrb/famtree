import { describe, expect, it } from 'vitest';
import { addChild, updatePerson } from '../model/operations';
import { sampleTree } from '../model/sample';
import { applyChanges, diffTrees, isValidChange } from './changes';

describe('changes', () => {
  it('diffs only edited records and replays them', () => {
    const a = sampleTree();
    const someone = Object.keys(a.persons)[0];
    let b = updatePerson(a, someone, { notes: 'új' });
    [b] = addChild(b, someone, { firstName: 'X', lastName: 'Y', gender: 'unknown' });
    const changes = diffTrees(a, b);
    expect(changes.length).toBeLessThanOrEqual(3);
    const replayed = applyChanges(a, changes);
    expect(diffTrees(replayed, b)).toEqual([]);
    expect(JSON.parse(JSON.stringify(replayed))).toEqual(JSON.parse(JSON.stringify(b)));
  });

  it('validates untrusted changes', () => {
    expect(isValidChange({ kind: 'person', id: 'a', value: null })).toBe(true);
    expect(isValidChange({ kind: 'person', id: 'a', value: { id: 'a', firstName: 'A', lastName: '', gender: 'male' } })).toBe(true);
    expect(isValidChange({ kind: 'person', id: 'a', value: { id: 'b', firstName: 'A', lastName: '', gender: 'male' } })).toBe(false);
    expect(isValidChange({ kind: 'union', id: 'u', value: { id: 'u', partners: [], children: [] } })).toBe(false);
    expect(isValidChange({ kind: 'evil', id: 'u', value: null })).toBe(false);
  });
});
