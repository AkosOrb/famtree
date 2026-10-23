import { describe, expect, it } from 'vitest';
import { exportGedcom, importGedcom } from './gedcom';
import { sampleTree } from './sample';
import { fullName } from './types';

describe('gedcom', () => {
  it('round-trips the sample tree', () => {
    const original = sampleTree();
    const copy = importGedcom(exportGedcom(original));
    expect(Object.keys(copy.persons)).toHaveLength(Object.keys(original.persons).length);
    expect(Object.keys(copy.unions)).toHaveLength(Object.keys(original.unions).length);
    const names = (t: typeof original) => Object.values(t.persons).map((p) => `${fullName(p)} ${p.birthYear} ${p.deathYear} ${p.gender}`).sort();
    expect(names(copy)).toEqual(names(original));
    const families = (t: typeof original) =>
      Object.values(t.unions)
        .map((u) => [u.partners.map((p) => fullName(t.persons[p])).sort().join('+'), u.children.map((c) => fullName(t.persons[c])).sort().join(',')].join(' > '))
        .sort();
    expect(families(copy)).toEqual(families(original));
  });

  it('reads typical GEDCOM from other software', () => {
    const tree = importGedcom(
      [
        '0 HEAD',
        '1 CHAR UTF-8',
        '0 @I1@ INDI',
        '1 NAME Kovács /Péter/',
        '1 SEX M',
        '1 BIRT',
        '2 DATE 12 MAR 1901',
        '1 NOTE Első sor',
        '2 CONT második sor',
        '0 @I2@ INDI',
        '1 NAME Anna /Kiss/',
        '1 SEX F',
        '1 DEAT Y',
        '0 @I3@ INDI',
        '1 NAME Béla /Kovács/',
        '0 @F1@ FAM',
        '1 HUSB @I1@',
        '1 WIFE @I2@',
        '1 CHIL @I3@',
        '0 TRLR',
      ].join('\r\n'),
    );
    const people = Object.values(tree.persons);
    expect(people.find((p) => p.lastName === 'Péter')?.birthYear).toBe(1901);
    expect(people.find((p) => p.lastName === 'Péter')?.notes).toBe('Első sor\nmásodik sor');
    expect(Object.values(tree.unions)[0].children).toHaveLength(1);
  });

  it('rejects non-GEDCOM input', () => {
    expect(() => importGedcom('hello')).toThrow();
  });
});
