import { describe, expect, it } from 'vitest';
import { buildIndex, childrenOf, parentsOf, partnersOf } from './graph';
import {
  addChild,
  addParent,
  addPartner,
  addPerson,
  linkChild,
  linkPartners,
  removePerson,
  setOtherParent,
  TreeError,
  unlinkParent,
  unlinkPartners,
} from './operations';
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

describe('editing existing relationships', () => {
  const p = (firstName: string): PersonInput => ({ firstName, lastName: 'T', gender: 'unknown' });
  const family = () => {
    let t = emptyTree();
    let mom: string, dad: string, kid: string, other: string;
    [t, mom] = addPerson(t, p('Anya'));
    [t, dad] = addPartner(t, mom, p('Apa'));
    [t, kid] = addChild(t, mom, p('Gyerek'), dad);
    [t, other] = addPartner(t, dad, p('Másik'));
    return { t, mom, dad, kid, other };
  };

  it('removes one parent and keeps the other parent and the couple', () => {
    const { t: t0, mom, dad, kid } = family();
    const t = unlinkParent(t0, kid, dad);
    const index = buildIndex(t);
    expect(parentsOf(t, index, kid)).toEqual([mom]);
    expect(partnersOf(t, index, mom)).toEqual([dad]);
    expect(childrenOf(t, index, dad)).toEqual([]);
  });

  it('removes the last parent without leaving empty families behind', () => {
    const { t: t0, mom, dad, kid } = family();
    const t = unlinkParent(unlinkParent(t0, kid, dad), kid, mom);
    expect(parentsOf(t, buildIndex(t), kid)).toEqual([]);
    expect(Object.values(t.unions).every((u) => u.partners.length === 2 || u.children.length > 0)).toBe(true);
  });

  it('ends a partnership only when the couple has no children together', () => {
    const { t, mom, dad, other } = family();
    expect(() => unlinkPartners(t, mom, dad)).toThrow(TreeError);
    const after = unlinkPartners(t, dad, other);
    expect(partnersOf(after, buildIndex(after), dad)).toEqual([mom]);
  });

  it('moves a child to another partner of the parent, or to the parent alone', () => {
    const { t: t0, mom, dad, kid, other } = family();
    let t = setOtherParent(t0, dad, kid, other);
    expect(parentsOf(t, buildIndex(t), kid).sort()).toEqual([dad, other].sort());
    // Mom and Dad remain a couple without children.
    expect(partnersOf(t, buildIndex(t), mom)).toEqual([dad]);
    t = setOtherParent(t, dad, kid, undefined);
    expect(parentsOf(t, buildIndex(t), kid)).toEqual([dad]);
  });
});
