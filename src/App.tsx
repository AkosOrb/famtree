import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { PersonPanel } from './components/PersonPanel';
import { Toolbar } from './components/Toolbar';
import { TreeCanvas } from './components/TreeCanvas';
import { computeLayout } from './layout/layout';
import { buildIndex } from './model/graph';
import { addPerson, TreeError } from './model/operations';
import { sampleTree } from './model/sample';
import { focusSubtree } from './model/subtree';
import { localRepository } from './model/storage';
import type { FamilyTree, Id } from './model/types';
import { historyReducer } from './state';

export interface Focus {
  id: Id;
  nonce: number;
}

/** 0 = whole tree; otherwise generations shown above and below the focus person. */
export type ViewDepth = 0 | 2 | 3 | 5;

export function App() {
  const [history, dispatch] = useReducer(historyReducer, undefined, () => ({
    past: [],
    present: localRepository.load() ?? sampleTree(),
    future: [],
  }));
  const tree = history.present;
  const [selectedId, setSelectedId] = useState<Id | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [fitNonce, setFitNonce] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [viewDepth, setViewDepth] = useState<ViewDepth>(0);
  const [viewRoot, setViewRoot] = useState<Id | null>(null);

  const index = useMemo(() => buildIndex(tree), [tree]);
  const focusRoot = viewDepth && viewRoot && tree.persons[viewRoot] ? viewRoot : null;
  const view = useMemo(
    () => (focusRoot ? focusSubtree(tree, index, focusRoot, viewDepth, viewDepth) : { tree, truncated: new Set<Id>() }),
    [tree, index, focusRoot, viewDepth],
  );
  const layout = useMemo(() => computeLayout(view.tree), [view.tree]);

  useEffect(() => {
    const handle = setTimeout(() => localRepository.save(tree), 400);
    return () => clearTimeout(handle);
  }, [tree]);

  useEffect(() => {
    if (selectedId && !tree.persons[selectedId]) setSelectedId(null);
  }, [tree, selectedId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? 'redo' : 'undo' });
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        dispatch({ type: 'redo' });
      } else if (e.key === 'Escape') {
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** Runs a model edit, records it in history and surfaces validation errors. */
  const edit = useCallback(
    <T,>(fn: (t: FamilyTree) => T, pick: (r: T) => FamilyTree): T | undefined => {
      try {
        const result = fn(tree);
        dispatch({ type: 'apply', tree: pick(result) });
        setError(null);
        return result;
      } catch (e) {
        if (e instanceof TreeError) setError(e.message);
        else throw e;
        return undefined;
      }
    },
    [tree],
  );

  const select = useCallback(
    (id: Id | null, center = false) => {
      setSelectedId(id);
      // In focus view, jumping to someone outside the visible part re-centres the view on them.
      if (id && focusRoot && !view.tree.persons[id]) setViewRoot(id);
      if (id && center) setFocus({ id, nonce: Date.now() });
    },
    [focusRoot, view.tree],
  );

  const focusOn = useCallback(
    (id: Id) => {
      setViewRoot(id);
      if (!viewDepth) setViewDepth(3);
      setSelectedId(id);
      setFitNonce((n) => n + 1);
    },
    [viewDepth],
  );

  const changeDepth = (depth: ViewDepth) => {
    setViewDepth(depth);
    if (depth && !focusRoot) setViewRoot(selectedId ?? Object.keys(tree.persons)[0] ?? null);
    setFitNonce((n) => n + 1);
  };

  const replaceTree = (t: FamilyTree) => {
    dispatch({ type: 'replace', tree: t });
    setSelectedId(null);
    setFitNonce((n) => n + 1);
  };

  const addFirstPerson = () => {
    const result = edit(
      (t) => addPerson(t, { firstName: 'Új', lastName: 'Személy', gender: 'unknown' }),
      ([t]) => t,
    );
    if (result) select(result[1], true);
  };

  return (
    <div className="app">
      <Toolbar
        tree={tree}
        canUndo={history.past.length > 0}
        canRedo={history.future.length > 0}
        onUndo={() => dispatch({ type: 'undo' })}
        onRedo={() => dispatch({ type: 'redo' })}
        onAddPerson={addFirstPerson}
        onSelect={(id) => select(id, true)}
        onReplace={replaceTree}
        onFit={() => setFitNonce((n) => n + 1)}
        onError={setError}
        viewDepth={focusRoot ? viewDepth : 0}
        onViewDepth={changeDepth}
      />
      <main className="main">
        <TreeCanvas
          tree={tree}
          layout={layout}
          truncated={view.truncated}
          focusRoot={focusRoot}
          onFocusOn={focusOn}
          selectedId={selectedId}
          focus={focus}
          fitNonce={fitNonce}
          onSelect={select}
          onAddFirst={addFirstPerson}
        />
        {error && (
          <div className="toast" role="alert" onClick={() => setError(null)}>
            {error}
          </div>
        )}
        {selectedId && tree.persons[selectedId] && (
          <PersonPanel
            key={selectedId}
            tree={tree}
            index={index}
            personId={selectedId}
            edit={edit}
            onSelect={(id) => select(id, true)}
            onFocusOn={focusOn}
            onClose={() => select(null)}
          />
        )}
      </main>
    </div>
  );
}
