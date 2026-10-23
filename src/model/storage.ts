import type { FamilyTree } from './types';

/**
 * Persistence boundary. The prototype stores the tree in localStorage; a
 * server-backed implementation (REST, sync, multi-user) can replace it
 * without touching the UI or the model.
 */
export interface TreeRepository {
  load(): FamilyTree | null;
  save(tree: FamilyTree): void;
}

const KEY = 'famtree:v1';

export const localRepository: TreeRepository = {
  load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? parseTree(raw) : null;
    } catch {
      return null;
    }
  },
  save(tree) {
    try {
      localStorage.setItem(KEY, JSON.stringify(tree));
    } catch {
      // Quota exceeded or storage disabled: the app keeps working in memory.
    }
  },
};

export function parseTree(raw: string): FamilyTree {
  const data = JSON.parse(raw);
  if (!data || data.version !== 1 || typeof data.persons !== 'object' || typeof data.unions !== 'object') {
    throw new Error('Érvénytelen családfa fájl.');
  }
  return data as FamilyTree;
}
