import type { FamilyTree } from './model/types';

/** Tree state with bounded undo/redo history. Trees are immutable, so snapshots are cheap. */
export interface HistoryState {
  past: FamilyTree[];
  present: FamilyTree;
  future: FamilyTree[];
}

export type HistoryAction =
  | { type: 'apply'; tree: FamilyTree }
  | { type: 'replace'; tree: FamilyTree }
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
