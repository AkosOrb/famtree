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

export interface FamilyTree {
  version: 1;
  persons: Record<Id, Person>;
  unions: Record<Id, Union>;
}

export type PersonInput = Omit<Person, 'id'>;

export const emptyTree = (): FamilyTree => ({ version: 1, persons: {}, unions: {} });

export const fullName = (p: Pick<Person, 'firstName' | 'lastName'>): string =>
  `${p.lastName} ${p.firstName}`.trim() || 'Névtelen';
