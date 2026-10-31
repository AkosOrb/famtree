import { describe, expect, it } from 'vitest';
import { addStory, removePerson, removeStory, storiesWith, TreeError, updateStory } from './operations';
import { DEFAULT_PRIVACY, redactTree, storyVisible } from './privacy';
import { inLawTree, sampleTree } from './sample';
import { applyChanges, diffTrees, isValidChange, isValidTree, sanitizeTree } from '../sync/changes';
import { fullName, sortedStories, storiesOf, type FamilyTree } from './types';

const idOf = (t: FamilyTree, name: string) => Object.values(t.persons).find((p) => fullName(p) === name)!.id;

describe('family history cards', () => {
  it('adds, edits and removes a story with its members', () => {
    let t = sampleTree();
    const janos = idOf(t, 'Kovács János');
    const maria = idOf(t, 'Szabó Mária');
    let id: string;
    [t, id] = addStory(t, { title: '  Esküvő ', text: 'Nagy lakodalom.', members: [janos, maria, janos], date: ' ' });
    expect(storiesOf(t)[id]).toEqual({ id, title: 'Esküvő', text: 'Nagy lakodalom.', members: [janos, maria] });
    t = updateStory(t, id, { date: '1956', place: 'Kecskemét' });
    expect(storiesOf(t)[id].date).toBe('1956');
    expect(storiesWith(t, maria).map((s) => s.id)).toEqual([id]);
    expect(() => updateStory(t, id, { title: '' })).toThrow(TreeError);
    expect(() => addStory(t, { title: 'X', text: '', members: ['nincs'] })).toThrow(TreeError);
    expect(storiesOf(removeStory(t, id))[id]).toBeUndefined();
  });

  it('drops a deleted person from their stories', () => {
    let t = inLawTree();
    const janos = idOf(t, 'Kovács János');
    t = removePerson(t, janos);
    for (const s of Object.values(storiesOf(t))) expect(s.members).not.toContain(janos);
    expect(Object.keys(storiesOf(t))).toHaveLength(2);
  });

  it('orders stories by the year in their date', () => {
    const s = (title: string, date?: string) => ({ id: title, title, date, text: '', members: [] });
    expect(sortedStories([s('c'), s('b', '1972 nyara'), s('a', 'kb. 1956')]).map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('syncs and validates stories like other records', () => {
    const a = sampleTree();
    const [b] = addStory(a, { title: 'T', text: 'x', members: [Object.keys(a.persons)[0]] });
    const changes = diffTrees(a, b);
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe('story');
    expect(changes.every(isValidChange)).toBe(true);
    expect(diffTrees(applyChanges(a, changes), b)).toEqual([]);
    expect(isValidChange({ kind: 'story', id: 's', value: { id: 's', title: ' ', text: '', members: [] } })).toBe(false);
    expect(isValidTree(b)).toBe(true);
    const tampered = { ...b, stories: { s: { id: 's', title: 'T', text: '', members: [], extra: 1 } } };
    expect(isValidTree(tampered)).toBe(true);
    expect(storiesOf(sanitizeTree(tampered as FamilyTree)).s).toEqual({ id: 's', title: 'T', text: '', members: [] });
  });

  it('hides stories about hidden people from view links', () => {
    const t = inLawTree();
    const [wedding, house] = sortedStories(Object.values(storiesOf(t)));
    // The wedding is about two deceased people; the house story includes the living István.
    expect(storyVisible(wedding, t.persons, DEFAULT_PRIVACY, 2026)).toBe(true);
    expect(storyVisible(house, t.persons, DEFAULT_PRIVACY, 2026)).toBe(false);
    expect(storyVisible(wedding, t.persons, { ...DEFAULT_PRIVACY, hideNotes: true }, 2026)).toBe(false);
    expect(storyVisible({ ...wedding, private: true }, t.persons, DEFAULT_PRIVACY, 2026)).toBe(false);
    expect(Object.keys(storiesOf(redactTree(t, DEFAULT_PRIVACY)))).toEqual([wedding.id]);
  });
});
