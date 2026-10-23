import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { PersonPanel } from './components/PersonPanel';
import { AccountDialog } from './components/AccountDialog';
import { ConfirmHost } from './components/ConfirmDialog';
import { PathCard } from './components/PathCard';
import { PrivacyDialog } from './components/PrivacyDialog';
import { ShareDialog } from './components/ShareDialog';
import { Toolbar } from './components/Toolbar';
import { TreeCanvas } from './components/TreeCanvas';
import { computeLayout } from './layout/layout';
import { buildIndex } from './model/graph';
import { addPerson, TreeError } from './model/operations';
import { inLawTree } from './model/sample';
import { findPath } from './model/relationship';
import { focusSubtree } from './model/subtree';
import { DEFAULT_PRIVACY, type PrivacySettings } from './model/privacy';
import { localRepository } from './model/storage';
import { emptyTree, type FamilyTree, type Id } from './model/types';
import { api, sessionFromUrl, shareUrl, type Role, type ServerSession, type User } from './sync/api';
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
  privacy?: PrivacySettings;
  canSetPrivacy?: boolean;
}

export function App() {
  const [session, setSession] = useState<ServerSession | null>(sessionFromUrl);
  const [remote, setRemote] = useState<RemoteTree | null>(null);
  const [history, dispatch] = useReducer(historyReducer, undefined, () => ({
    past: [],
    present: session ? emptyTree() : (localRepository.load() ?? inLawTree()),
    future: [],
  }));
  const tree = history.present;
  const loading = !!session && !remote;
  const readOnly = loading || remote?.role === 'viewer';
  const [shareOpen, setShareOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  /** undefined while unknown; null when signed out or no server is running. */
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [serverAvailable, setServerAvailable] = useState(false);

  useEffect(() => {
    api
      .me()
      .then((u) => {
        setUser(u);
        setServerAvailable(true);
      })
      .catch(() => setUser(null)); // No API server: local mode only.
  }, []);
  const [selectedId, setSelectedId] = useState<Id | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [fitNonce, setFitNonce] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [pathEnds, setPathEnds] = useState<{ from: Id; to: Id } | null>(null);
  const [viewDepth, setViewDepth] = useState<ViewDepth>(0);
  const [viewRoot, setViewRoot] = useState<Id | null>(null);

  const index = useMemo(() => buildIndex(tree), [tree]);
  const focusRoot = viewDepth && viewRoot && tree.persons[viewRoot] ? viewRoot : null;
  const view = useMemo(
    () => (focusRoot ? focusSubtree(tree, index, focusRoot, viewDepth, viewDepth) : { tree, truncated: new Set<Id>() }),
    [tree, index, focusRoot, viewDepth],
  );
  const layout = useMemo(() => computeLayout(view.tree), [view.tree]);

  const activePath = pathEnds && tree.persons[pathEnds.from] && tree.persons[pathEnds.to] ? pathEnds : null;
  const path = useMemo(
    () => (activePath ? findPath(tree, index, activePath.from, activePath.to) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tree, index, activePath?.from, activePath?.to],
  );

  const showPath = (from: Id, to: Id) => {
    setPathEnds({ from, to });
    // The path may leave a focus view, so show the whole tree.
    setViewDepth(0);
  };

  // Local mode persists to this browser; server mode syncs with the backend.
  useEffect(() => {
    if (session) return;
    const handle = setTimeout(() => {
      if (!localRepository.save(tree)) {
        setError(
          'A böngésző tárhelye megtelt, a legutóbbi módosítás nincs elmentve. Exportáld a fát, vagy töltsd fel a szerverre.',
        );
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [tree, session]);

  useEffect(() => {
    if (!session) return;
    api
      .load(session)
      .then((r) => {
        dispatch({ type: 'replace', tree: r.tree });
        setRemote({
          name: r.name,
          role: r.role,
          initial: { tree: r.tree, version: r.version },
          privacy: r.privacy,
          canSetPrivacy: r.canSetPrivacy,
        });
        setFitNonce((n) => n + 1);
      })
      .catch((e: Error) => {
        setError(
          `A családfa nem tölthető be: ${e.message}${session.key ? '' : ' Jelentkezz be a tulajdonos fiókjával.'}`,
        );
        if (!session.key) setAccountOpen(true);
      });
    // Loads once for the session found in the URL; later sessions come from uploading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onRemote = useCallback(
    (t: FamilyTree, changes: Change[]) => dispatch({ type: 'remote', tree: t, changes }),
    [],
  );
  const syncStatus = useServerSync(
    remote ? session : null,
    remote?.initial ?? null,
    tree,
    onRemote,
    remote?.role === 'owner' || remote?.role === 'editor',
  );

  const upload = async (name: string) => {
    const r = await api.create(name, tree);
    window.history.replaceState(null, '', shareUrl(r.id, r.editKey));
    setSession({ treeId: r.id, key: r.editKey });
    setRemote({
      name,
      role: user ? 'owner' : 'editor',
      initial: { tree, version: r.version },
      privacy: DEFAULT_PRIVACY,
      canSetPrivacy: true,
    });
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
        onShare={serverAvailable ? () => setShareOpen(true) : undefined}
        user={user}
        onAccount={serverAvailable ? () => setAccountOpen(true) : undefined}
        onPrivacy={() => setPrivacyOpen(true)}
      />
      <main className="main">
        <TreeCanvas
          tree={tree}
          layout={layout}
          truncated={view.truncated}
          focusRoot={focusRoot}
          onFocusOn={focusOn}
          path={path}
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
        {activePath && (
          <PathCard
            tree={tree}
            from={activePath.from}
            to={activePath.to}
            path={path}
            onSelect={(id) => select(id, true)}
            onClose={() => setPathEnds(null)}
          />
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
            onFindPath={(other) => showPath(selectedId, other)}
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
          signedIn={!!user}
          privacy={remote?.privacy}
          canSetPrivacy={!!remote?.canSetPrivacy}
          onPrivacy={(privacy) => setRemote((r) => r && { ...r, privacy })}
          onSessionKey={(key) => {
            window.history.replaceState(null, '', shareUrl(session!.treeId, key));
            setSession({ treeId: session!.treeId, key });
          }}
        />
      )}
      {accountOpen && (
        <AccountDialog
          user={user ?? null}
          currentTreeId={remote ? session?.treeId : undefined}
          onUser={(u) => {
            setUser(u);
            // A tree that failed to load for lack of access may open now.
            if (u && session && !remote) window.location.reload();
          }}
          onShowPrivacy={() => setPrivacyOpen(true)}
          onClose={() => setAccountOpen(false)}
        />
      )}
      {privacyOpen && <PrivacyDialog serverAvailable={serverAvailable} onClose={() => setPrivacyOpen(false)} />}
      <ConfirmHost />
    </div>
  );
}
