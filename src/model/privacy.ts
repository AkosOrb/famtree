import { storiesOf, type FamilyTree, type Id, type Person, type Story } from './types';

/**
 * What read-only (view link) visitors may see. Editors and the owner always
 * get the full data; redaction happens on the server, so hidden details never
 * leave it.
 */
export interface PrivacySettings {
  /** Probably living people (no death year, born less than 100 years ago) appear as "Rejtett személy". */
  hideLiving: boolean;
  hidePhotos: boolean;
  hideNotes: boolean;
}

/** Privacy by default: living people are hidden from view links unless the owner opts out. */
export const DEFAULT_PRIVACY: PrivacySettings = { hideLiving: true, hidePhotos: false, hideNotes: false };

export const LIVING_YEARS = 100;
/** How long the server keeps the sync change log (deleted data lingers there until then). */
export const CHANGE_LOG_DAYS = 30;
export const REDACTED_NAME = 'Rejtett személy';

export function isPrivacySettings(v: unknown): v is PrivacySettings {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  return typeof s.hideLiving === 'boolean' && typeof s.hidePhotos === 'boolean' && typeof s.hideNotes === 'boolean';
}

/** Conservative: without a death year, anyone born recently or at an unknown date counts as living. */
export const isLiving = (p: Person, year = new Date().getFullYear()) =>
  p.deathYear == null && (p.birthYear == null || year - p.birthYear < LIVING_YEARS);

/** The version of a person a view-link visitor receives. Keeps the id so relationships still draw. */
const isHidden = (p: Person, settings: PrivacySettings, year: number) =>
  !!p.private || (settings.hideLiving && isLiving(p, year));

export function redactPerson(p: Person, settings: PrivacySettings, year = new Date().getFullYear()): Person {
  if (isHidden(p, settings, year)) {
    return { id: p.id, firstName: '', lastName: REDACTED_NAME, gender: 'unknown', redacted: true };
  }
  if (!(settings.hidePhotos && p.photo) && !(settings.hideNotes && p.notes)) return p;
  const copy = { ...p };
  if (settings.hidePhotos) delete copy.photo;
  if (settings.hideNotes) delete copy.notes;
  return copy;
}

/**
 * Whether a view-link visitor may read a story. Stories are free text like
 * notes, and may tell about the hidden people they mention, so a story is
 * withheld if it is private, notes are hidden, or any of its members is hidden.
 * `persons` must be the unredacted records.
 */
export function storyVisible(
  s: Story,
  persons: Record<Id, Person>,
  settings: PrivacySettings,
  year = new Date().getFullYear(),
): boolean {
  if (s.private || settings.hideNotes) return false;
  return s.members.every((m) => !persons[m] || !isHidden(persons[m], settings, year));
}

export function redactTree(tree: FamilyTree, settings: PrivacySettings): FamilyTree {
  const year = new Date().getFullYear();
  const persons: Record<Id, Person> = {};
  for (const p of Object.values(tree.persons)) persons[p.id] = redactPerson(p, settings, year);
  const stories: FamilyTree['stories'] = {};
  for (const s of Object.values(storiesOf(tree))) if (storyVisible(s, tree.persons, settings, year)) stories[s.id] = s;
  return { ...tree, persons, stories };
}
