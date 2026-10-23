import { describe, expect, it } from 'vitest';
import { buildIndex, childrenOf, parentsOf, partnersOf } from './graph';
import { addChild, addParent, addPartner, addPerson, linkChild, linkPartners, removePerson, TreeError } from './operations';
import { emptyTree, type PersonInput } from './types';

const input = (firstName: string): PersonInput => ({ firstName, lastName: 'Teszt', gender: 'unknown' });

describe('operations', () => {
  it('builds a couple with children', () => {
    let t = emptyTree();
    const [t1, a] = addPerson(t, input('A'));
    const [t2, b] = addPartner(t1, a, input('B'));
    const [t3, c] = addChild(t2, a, input('C'), b);
    t = t3;
    const idx = buildIndex(t);
    expect(partnersOf(t, idx, a)).toEqual([b]);
    expect(parentsOf(t, idx, c).sort()).toEqual([a, b].sort());
    expect(Object.keys(t.unions)).toHaveLength(1);
  });

  it('turns a single-parent family into a couple when a parent is added', () => {
    const [t1, child] = addPerson(emptyTree(), input('Gyerek'));
    const [t2, mom] = addParent(t1, child, input('Anya'));
    const [t3, dad] = addParent(t2, child, input('Apa'));
    const idx = buildIndex(t3);
    expect(parentsOf(t3, idx, child).sort()).toEqual([mom, dad].sort());
    expect(() => addParent(t3, child, input('Harmadik'))).toThrow(TreeError);
  });

  it('rejects cycles', () => {
    const [t1, a] = addPerson(emptyTree(), input('A'));
    const [t2, b] = addChild(t1, a, input('B'));
    expect(() => linkChild(t2, b, a)).toThrow(TreeError);
    expect(() => linkPartners(t2, a, b)).toThrow(TreeError);
  });

  it('cleans up empty unions when removing a person', () => {
    const [t1, a] = addPerson(emptyTree(), input('A'));
    const [t2, b] = addPartner(t1, a, input('B'));
    const t3 = removePerson(t2, b);
    expect(Object.keys(t3.unions)).toHaveLength(0);
    expect(childrenOf(t3, buildIndex(t3), a)).toEqual([]);
  });
});
