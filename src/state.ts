import type { FamilyTree } from './model/types';
import { applyChanges, type Change } from './sync/changes';

/** Tree state with bounded undo/redo history. Trees are immutable, so snapshots are cheap. */
export interface HistoryState {
  past: FamilyTree[];
  present: FamilyTree;
  future: FamilyTree[];
}

export type HistoryAction =
  | { type: 'apply'; tree: FamilyTree }
  | { type: 'replace'; tree: FamilyTree }
  /** Changes made by someone else: replayed into every snapshot so undo keeps them. */
  | { type: 'remote'; tree: FamilyTree; changes: Change[] }
  | { type: 'undo' }
  | { type: 'redo' };

const LIMIT = 100;

export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case 'apply':
      if (action.tree === state.present) return state;
      return { past: [...state.past, state.present].slice(-LIMIT), present: action.tree, future: [] };
    case 'replace':
      return { past: [], present: action.tree, future: [] };
    case 'remote':
      return {
        past: state.past.map((t) => applyChanges(t, action.changes)),
        present: action.tree,
        future: state.future.map((t) => applyChanges(t, action.changes)),
      };
    case 'undo': {
      if (!state.past.length) return state;
      const present = state.past[state.past.length - 1];
      return { past: state.past.slice(0, -1), present, future: [state.present, ...state.future] };
    }
    case 'redo': {
      if (!state.future.length) return state;
      const [present, ...future] = state.future;
      return { past: [...state.past, state.present], present, future };
    }
  }
}
