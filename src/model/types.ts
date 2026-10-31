export type Id = string;

export type Gender = 'male' | 'female' | 'other' | 'unknown';

export interface Person {
  id: Id;
  firstName: string;
  lastName: string;
  gender: Gender;
  birthYear?: number;
  deathYear?: number;
  notes?: string;
  /** Small square JPEG as a data URL (see model/photo.ts). */
  photo?: string;
  /** Always hidden from read-only (view link) visitors, whatever the tree's privacy settings. */
  private?: boolean;
  /** Set by the server on records a viewer may not see in full (see model/privacy.ts). */
  redacted?: boolean;
}

/**
 * A union is a family unit: one or two partners and their common children.
 * Relationships are stored only here, so persons stay plain records and the
 * graph can be indexed in a single pass (see buildIndex).
 */
export interface Union {
  id: Id;
  partners: Id[];
  children: Id[];
}

/**
 * A family history card: a story, event or memory with the family members it
 * is about. Members are referenced by id; deleting a person removes them here.
 */
export interface Story {
  id: Id;
  title: string;
  /** Free text, e.g. "1956 ősze" or "1920 körül"; the first 4-digit year orders the list. */
  date?: string;
  place?: string;
  text: string;
  members: Id[];
  /** Always hidden from read-only (view link) visitors. */
  private?: boolean;
}

export interface FamilyTree {
  version: 1;
  persons: Record<Id, Person>;
  unions: Record<Id, Union>;
  /** Optional, so trees saved before stories existed stay valid. */
  stories?: Record<Id, Story>;
}

export type StoryInput = Omit<Story, 'id'>;

const NO_STORIES: Record<Id, Story> = Object.freeze({}) as Record<Id, Story>;
export const storiesOf = (tree: FamilyTree): Record<Id, Story> => tree.stories ?? NO_STORIES;

/** Year used for ordering stories, or undefined when the date has none. */
export function storyYear(s: Pick<Story, 'date'>): number | undefined {
  const m = s.date?.match(/-?\d{3,4}/);
  return m ? Number(m[0]) : undefined;
}

/** Stories in chronological order (undated ones last, then by title). */
export function sortedStories(stories: Iterable<Story>): Story[] {
  return [...stories].sort((a, b) => {
    const ya = storyYear(a) ?? Infinity;
    const yb = storyYear(b) ?? Infinity;
    return ya !== yb ? ya - yb : a.title.localeCompare(b.title, 'hu');
  });
}

export type PersonInput = Omit<Person, 'id'>;

export const emptyTree = (): FamilyTree => ({ version: 1, persons: {}, unions: {} });

export const fullName = (p: Pick<Person, 'firstName' | 'lastName'>): string =>
  `${p.lastName} ${p.firstName}`.trim() || 'Névtelen';
