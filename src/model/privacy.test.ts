import { describe, expect, it } from 'vitest';
import { DEFAULT_PRIVACY, isLiving, redactPerson, redactTree, REDACTED_NAME } from './privacy';
import { sampleTree } from './sample';
import type { Person } from './types';

const person = (patch: Partial<Person>): Person => ({
  id: 'p',
  firstName: 'Anna',
  lastName: 'Nagy',
  gender: 'female',
  notes: 'titok',
  photo: 'data:image/jpeg;base64,AAAA',
  ...patch,
});

describe('privacy', () => {
  it('treats people without a death year as living unless born long ago', () => {
    expect(isLiving(person({ birthYear: 1990 }), 2026)).toBe(true);
    expect(isLiving(person({}), 2026)).toBe(true);
    expect(isLiving(person({ birthYear: 1900 }), 2026)).toBe(false);
    expect(isLiving(person({ birthYear: 1990, deathYear: 2020 }), 2026)).toBe(false);
  });

  it('redacts living and private people completely, keeping only the id', () => {
    const settings = DEFAULT_PRIVACY;
    expect(redactPerson(person({ birthYear: 1990 }), settings, 2026)).toEqual({
      id: 'p',
      firstName: '',
      lastName: REDACTED_NAME,
      gender: 'unknown',
      redacted: true,
    });
    const dead = person({ birthYear: 1900, deathYear: 1970 });
    expect(redactPerson(dead, settings, 2026)).toBe(dead);
    expect(redactPerson({ ...dead, private: true }, settings, 2026).redacted).toBe(true);
  });

  it('can drop photos and notes only', () => {
    const settings = { hideLiving: false, hidePhotos: true, hideNotes: true };
    const r = redactPerson(person({ birthYear: 1990 }), settings, 2026);
    expect(r.firstName).toBe('Anna');
    expect(r.photo).toBeUndefined();
    expect(r.notes).toBeUndefined();
  });

  it('keeps the structure of the tree', () => {
    const tree = sampleTree();
    const redacted = redactTree(tree, DEFAULT_PRIVACY);
    expect(redacted.unions).toBe(tree.unions);
    expect(Object.keys(redacted.persons)).toEqual(Object.keys(tree.persons));
    const names = Object.values(redacted.persons).map((p) => p.lastName);
    expect(names).toContain(REDACTED_NAME);
    expect(names).toContain('Kovács'); // János (1932–2008)
  });
});
