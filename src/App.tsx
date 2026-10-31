import { lazy, Suspense, useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { PersonPanel } from './components/PersonPanel';
import { AccountDialog } from './components/AccountDialog';
import { ConfirmHost } from './components/ConfirmDialog';
import { PathCard } from './components/PathCard';
import { StoriesPanel } from './components/StoriesPanel';
import { PrivacyDialog } from './components/PrivacyDialog';
import { ShareDialog } from './components/ShareDialog';
import { Toolbar } from './components/Toolbar';
import { TreeCanvas } from './components/TreeCanvas';
import { computeLayout } from './layout/layout';
import { buildIndex } from './model/graph';
import { addPerson, TreeError } from './model/operations';
import { inLawTree } from './model/sample';
import { findPath } from './model/relationship';
import { familyNames, familySubtree, lineageSubtree, type LineageMode } from './model/subtree';
import { DEFAULT_PRIVACY, type PrivacySettings } from './model/privacy';
import { localRepository } from './model/storage';
import { emptyTree, storiesOf, type FamilyTree, type Id } from './model/types';
import { api, sessionFromUrl, shareUrl, type Role, type ServerSession, type User } from './sync/api';
import type { Change } from './sync/changes';
import { useServerSync } from './sync/useServerSync';
import { historyReducer } from './state';

// three.js is large: load it only when someone opens the 3D view.
const TreeCanvas3D = lazy(() => import('./components/TreeCanvas3D'));

export interface Focus {
  id: Id;
  nonce: number;
}

/**
 * 'all' = whole tree; 'family' = one family name and those who married in; otherwise the part
 * around the view's root person (see model/subtree.ts).
 */
export type ViewMode = 'all' | 'family' | LineageMode;
/** Generations shown from the root person; 0 = all generations. */
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
  const [viewMode, setViewMode] = useState<ViewMode>('all');
  const [viewDepth, setViewDepth] = useState<ViewDepth>(3);
  const [viewRoot, setViewRoot] = useState<Id | null>(null);
  const [viewFamily, setViewFamily] = useState<string | null>(null);
  const [storiesOpen, setStoriesOpen] = useState(false);
  const [is3d, setIs3d] = useState(false);
  const [activeStory, setActiveStory] = useState<Id | null>(null);

  const index = useMemo(() => buildIndex(tree), [tree]);
  const families = useMemo(() => familyNames(tree), [tree]);
  const family = viewMode === 'family' && viewFamily && families.some((f) => f.name === viewFamily) ? viewFamily : null;
  const focusRoot = viewMode !== 'all' && viewMode !== 'family' && viewRoot && tree.persons[viewRoot] ? viewRoot : null;
  const view = useMemo(
    () =>
      family
        ? familySubtree(tree, index, family)
        : focusRoot && viewMode !== 'all' && viewMode !== 'family'
          ? lineageSubtree(tree, index, focusRoot, viewMode, viewDepth || Infinity)
          : { tree, truncated: new Set<Id>() },
    [tree, index, family, focusRoot, viewMode, viewDepth],
  );

  const story = activeStory ? storiesOf(tree)[activeStory] : undefined;
  // Keyed by the member list, so unrelated edits do not re-trigger zooming to the group.
  const memberKey = story ? JSON.stringify(story.members.filter((m) => tree.persons[m])) : '';
  const highlight = useMemo(() => (memberKey ? new Set<Id>(JSON.parse(memberKey)) : null), [memberKey]);
  const layout = useMemo(() => computeLayout(view.tree), [view.tree]);

  const activePath = pathEnds && tree.persons[pathEnds.from] && tree.persons[pathEnds.to] ? pathEnds : null;
  const path = useMemo(
    () => (activePath ? findPath(tree, index, activePath.from, activePath.to) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tree, index, activePath?.from, activePath?.to],
  );

  const showPath = (from: Id, to: Id) => {
    setPathEnds({ from, to });
    setActiveStory(null);
    // The path may leave a focus view, so show the whole tree.
    setViewMode('all');
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
      // Someone outside the family shown: show the whole tree again.
      if (id && family && !view.tree.persons[id]) setViewMode('all');
      if (id && center) setFocus({ id, nonce: Date.now() });
    },
    [focusRoot, family, view.tree],
  );

  /** Narrows the view to `id`; keeps the current mode, or uses `mode` when given. */
  const focusOn = useCallback((id: Id, mode?: LineageMode) => {
    setViewRoot(id);
    setViewMode((m) => mode ?? (m === 'all' || m === 'family' ? 'around' : m));
    setSelectedId(id);
    setFitNonce((n) => n + 1);
  }, []);

  const changeView = (mode: ViewMode, depth: ViewDepth, familyName?: string) => {
    setViewMode(mode);
    setViewDepth(depth);
    if (mode === 'family') {
      // The selected person's family, unless another one is picked; else the largest.
      const selected = selectedId ? tree.persons[selectedId]?.lastName.trim() : undefined;
      setViewFamily(familyName ?? family ?? (selected || families[0]?.name) ?? null);
    } else if (mode !== 'all' && !focusRoot) setViewRoot(selectedId ?? Object.keys(tree.persons)[0] ?? null);
    setFitNonce((n) => n + 1);
  };

  const showStory = (id: Id | null) => {
    setActiveStory(id);
    if (id) {
      setPathEnds(null);
      // Members may be outside a focused view.
      setViewMode('all');
    }
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
        viewMode={focusRoot || family ? viewMode : 'all'}
        families={families}
        family={family}
        viewDepth={viewDepth}
        onView={changeView}
        is3d={is3d}
        onToggle3d={() => {
          setIs3d((v) => !v);
          setFitNonce((n) => n + 1);
        }}
        storiesOpen={storiesOpen}
        onStories={() => setStoriesOpen((o) => !o)}
        readOnly={readOnly}
        treeName={remote?.name}
        syncStatus={remote ? (remote.role === 'viewer' ? 'readonly' : syncStatus) : loading ? 'loading' : 'local'}
        onShare={serverAvailable ? () => setShareOpen(true) : undefined}
        user={user}
        onAccount={serverAvailable ? () => setAccountOpen(true) : undefined}
        onPrivacy={() => setPrivacyOpen(true)}
      />
      <main className="main">
        {is3d ? (
          <Suspense
            fallback={
              <div className="canvas">
                <div className="empty">
                  <p>3D nézet betöltése…</p>
                </div>
              </div>
            }
          >
            <TreeCanvas3D
              tree={tree}
              layout={layout}
              truncated={view.truncated}
              focusRoot={focusRoot}
              onFocusOn={focusOn}
              path={path}
              highlight={highlight}
              selectedId={selectedId}
              focus={focus}
              fitNonce={fitNonce}
              onSelect={select}
              onAddFirst={readOnly ? undefined : addFirstPerson}
            />
          </Suspense>
        ) : (
          <TreeCanvas
            tree={tree}
            layout={layout}
            truncated={view.truncated}
            focusRoot={focusRoot}
            onFocusOn={focusOn}
            path={path}
            highlight={highlight}
            selectedId={selectedId}
            focus={focus}
            fitNonce={fitNonce}
            onSelect={select}
            onAddFirst={readOnly ? undefined : addFirstPerson}
          />
        )}
        {error && (
          <div className="toast" role="alert" onClick={() => setError(null)}>
            {error}
          </div>
        )}
        {storiesOpen && (
          <StoriesPanel
            tree={tree}
            edit={edit}
            readOnly={readOnly}
            selectedId={selectedId}
            activeStory={story ? activeStory : null}
            onShowStory={showStory}
            onSelect={(id) => select(id, true)}
            onFocusOn={(id, mode) => {
              setActiveStory(null);
              focusOn(id, mode);
            }}
            onClose={() => {
              setStoriesOpen(false);
              setActiveStory(null);
            }}
          />
        )}
        {activePath && (
          <PathCard
            shifted={storiesOpen}
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
            onOpenStory={(id) => {
              setStoriesOpen(true);
              showStory(id);
            }}
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
