import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { PersonPanel } from './components/PersonPanel';
import { ShareDialog } from './components/ShareDialog';
import { Toolbar } from './components/Toolbar';
import { TreeCanvas } from './components/TreeCanvas';
import { computeLayout } from './layout/layout';
import { buildIndex } from './model/graph';
import { addPerson, TreeError } from './model/operations';
import { sampleTree } from './model/sample';
import { focusSubtree } from './model/subtree';
import { localRepository } from './model/storage';
import { emptyTree, type FamilyTree, type Id } from './model/types';
import { api, sessionFromUrl, shareUrl, type Role, type ServerSession } from './sync/api';
import type { Change } from './sync/changes';
import { useServerSync } from './sync/useServerSync';
import { historyReducer } from './state';

export interface Focus {
  id: Id;
  nonce: number;
}

/** 0 = whole tree; otherwise generations shown above and below the focus person. */
export type ViewDepth = 0 | 2 | 3 | 5;

interface RemoteTree {
  name: string;
  role: Role;
  initial: { tree: FamilyTree; version: number };
}

export function App() {
  const [session, setSession] = useState<ServerSession | null>(sessionFromUrl);
  const [remote, setRemote] = useState<RemoteTree | null>(null);
  const [history, dispatch] = useReducer(historyReducer, undefined, () => ({
    past: [],
    present: session ? emptyTree() : (localRepository.load() ?? sampleTree()),
    future: [],
  }));
  const tree = history.present;
  const loading = !!session && !remote;
  const readOnly = loading || remote?.role === 'viewer';
  const [shareOpen, setShareOpen] = useState(false);
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

  // Local mode persists to this browser; server mode syncs with the backend.
  useEffect(() => {
    if (session) return;
    const handle = setTimeout(() => localRepository.save(tree), 400);
    return () => clearTimeout(handle);
  }, [tree, session]);

  useEffect(() => {
    if (!session) return;
    api
      .load(session)
      .then((r) => {
        dispatch({ type: 'replace', tree: r.tree });
        setRemote({ name: r.name, role: r.role, initial: { tree: r.tree, version: r.version } });
        setFitNonce((n) => n + 1);
      })
      .catch((e: Error) => setError(`A családfa nem tölthető be: ${e.message}`));
    // Loads once for the session found in the URL; later sessions come from uploading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onRemote = useCallback((t: FamilyTree, changes: Change[]) => dispatch({ type: 'remote', tree: t, changes }), []);
  const syncStatus = useServerSync(
    remote ? session : null,
    remote?.initial ?? null,
    tree,
    onRemote,
    remote?.role === 'editor',
  );

  const upload = async (name: string) => {
    const r = await api.create(name, tree);
    window.history.replaceState(null, '', shareUrl(r.id, r.editKey));
    setSession({ treeId: r.id, key: r.editKey });
    setRemote({ name, role: 'editor', initial: { tree, version: r.version } });
  };

  useEffect(() => {
    if (selectedId && !tree.persons[selectedId]) setSelectedId(null);
  }, [tree, selectedId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select')) return;
      if (readOnly && e.key !== 'Escape') return;
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
  }, [readOnly]);

  /** Runs a model edit, records it in history and surfaces validation errors. */
  const edit = useCallback(
    <T,>(fn: (t: FamilyTree) => T, pick: (r: T) => FamilyTree): T | undefined => {
      if (readOnly) return undefined;
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
    [tree, readOnly],
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
        readOnly={readOnly}
        treeName={remote?.name}
        syncStatus={remote ? (remote.role === 'viewer' ? 'readonly' : syncStatus) : loading ? 'loading' : 'local'}
        onShare={() => setShareOpen(true)}
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
          onAddFirst={readOnly ? undefined : addFirstPerson}
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
            readOnly={readOnly}
          />
        )}
      </main>
      {shareOpen && (
        <ShareDialog
          session={remote ? session : null}
          role={remote?.role ?? null}
          onUpload={upload}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  );
}
