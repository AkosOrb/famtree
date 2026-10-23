import { describe, expect, it } from 'vitest';
import { buildIndex } from './graph';
import { addPerson } from './operations';
import { findPath, kinshipTerm, relationWord } from './relationship';
import { sampleTree } from './sample';
import { fullName } from './types';

const t = sampleTree();
const index = buildIndex(t);
const id = (name: string) => Object.values(t.persons).find((p) => fullName(p) === name)!.id;
const term = (a: string, b: string) => kinshipTerm(t, findPath(t, index, id(a), id(b))!);

describe('findPath', () => {
  it('finds the shortest chain of relationships', () => {
    const path = findPath(t, index, id('Kovács Máté'), id('Varga Luca'))!;
    expect(path.map((s) => fullName(t.persons[s.id]))).toEqual([
      'Kovács Máté',
      'Kovács Gábor',
      'Kovács István',
      'Kovács János',
      'Kovács Katalin',
      'Nagy Anna',
      'Varga Luca',
    ]);
    expect(path.map((s) => s.relation)).toEqual([null, 'parent', 'parent', 'parent', 'child', 'child', 'child']);
  });

  it('returns null for unconnected people', () => {
    const [t2, loner] = addPerson(t, { firstName: 'Magányos', lastName: 'Ember', gender: 'unknown' });
    expect(findPath(t2, buildIndex(t2), id('Kovács János'), loner)).toBeNull();
  });
});

describe('kinshipTerm', () => {
  it('names blood relatives', () => {
    expect(term('Kovács Máté', 'Kovács János')).toBe('dédnagyapja');
    expect(term('Kovács János', 'Kovács Máté')).toBe('dédunokája');
    expect(term('Kovács Gábor', 'Nagy Anna')).toBe('unokatestvére');
    expect(term('Kovács Gábor', 'Kovács Katalin')).toBe('nagynénje');
    expect(term('Kovács Katalin', 'Kovács Gábor')).toBe('unokaöccse');
    expect(term('Kovács Katalin', 'Kovács István')).toBe('bátyja');
    expect(term('Kovács Máté', 'Varga Luca')).toBe('2. fokú unokatestvére');
    expect(term('Kovács Máté', 'Nagy Anna')).toBe('5. fokú oldalági rokona');
  });

  it('names in-laws', () => {
    expect(term('Kovács János', 'Tóth Éva')).toBe('menye');
    expect(term('Tóth Éva', 'Szabó Mária')).toBe('anyósa');
    expect(term('Tóth Éva', 'Kovács Katalin')).toBe('sógornője');
    expect(term('Kovács István', 'Tóth Éva')).toBe('felesége');
  });

  it('words single steps by gender', () => {
    expect(relationWord('parent', 'female')).toBe('anyja');
    expect(relationWord('child', 'male')).toBe('fia');
    expect(relationWord('partner', 'unknown')).toBe('párja');
  });
});
