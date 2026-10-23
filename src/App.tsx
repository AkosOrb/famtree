import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { PersonPanel } from './components/PersonPanel';
import { Toolbar } from './components/Toolbar';
import { TreeCanvas } from './components/TreeCanvas';
import { computeLayout } from './layout/layout';
import { buildIndex } from './model/graph';
import { addPerson, TreeError } from './model/operations';
import { sampleTree } from './model/sample';
import { localRepository } from './model/storage';
import type { FamilyTree, Id } from './model/types';
import { historyReducer } from './state';

export interface Focus {
  id: Id;
  nonce: number;
}

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

  const index = useMemo(() => buildIndex(tree), [tree]);
  const layout = useMemo(() => computeLayout(tree, index), [tree, index]);

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

  const select = useCallback((id: Id | null, center = false) => {
    setSelectedId(id);
    if (id && center) setFocus({ id, nonce: Date.now() });
  }, []);

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
      />
      <main className="main">
        <TreeCanvas
          tree={tree}
          layout={layout}
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
            onClose={() => select(null)}
          />
        )}
      </main>
    </div>
  );
}
