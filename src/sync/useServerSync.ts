import { useEffect, useRef, useState } from 'react';
import type { FamilyTree } from '../model/types';
import { api, ApiError, type ServerSession } from './api';
import { applyChanges, diffTrees, type Change } from './changes';

export type SyncStatus = 'saved' | 'saving' | 'offline' | 'error';

const PUSH_DELAY = 700;
const POLL_INTERVAL = 5000;

/**
 * Keeps the local tree in sync with the server.
 *
 * `base` is the last state known to be on the server at `version`; local edits
 * are `diffTrees(base, local)`. Remote changes are applied to `base` and the
 * pending local edits replayed on top (last writer wins per record), so
 * concurrent editors converge without full reloads.
 */
export function useServerSync(
  session: ServerSession | null,
  initial: { tree: FamilyTree; version: number } | null,
  tree: FamilyTree,
  onRemote: (tree: FamilyTree, remote: Change[]) => void,
  canEdit: boolean,
): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>('saved');
  const state = useRef({ base: initial?.tree, version: initial?.version ?? 0, busy: false });
  const latest = useRef(tree);
  latest.current = tree;
  const onRemoteRef = useRef(onRemote);
  onRemoteRef.current = onRemote;

  useEffect(() => {
    state.current = { base: initial?.tree, version: initial?.version ?? 0, busy: false };
  }, [initial]);

  // Serialises pulls and pushes so `base`/`version` are never updated concurrently.
  const run = useRef(async (task: () => Promise<void>) => {
    if (state.current.busy) return false;
    state.current.busy = true;
    try {
      await task();
      return true;
    } finally {
      state.current.busy = false;
    }
  });

  /** The server's change log no longer reaches back to our version: start over from the full tree. */
  const reload = async (s: ServerSession) => {
    const st = state.current;
    const r = await api.load(s);
    if (!st.base) return;
    const pending = diffTrees(st.base, latest.current);
    const changes = diffTrees(st.base, r.tree);
    st.base = r.tree;
    st.version = r.version;
    const merged = applyChanges(st.base, pending);
    latest.current = merged;
    onRemoteRef.current(merged, changes);
  };

  const pull = async (s: ServerSession) => {
    const st = state.current;
    let result: { version: number; changes: Change[] };
    try {
      result = await api.changesSince(s, st.version);
    } catch (e) {
      if (e instanceof ApiError && e.status === 410) return reload(s);
      throw e;
    }
    const { version, changes } = result;
    if (!changes.length || !st.base) {
      st.version = version;
      return;
    }
    const pending = diffTrees(st.base, latest.current);
    st.base = applyChanges(st.base, changes);
    st.version = version;
    const merged = applyChanges(st.base, pending);
    latest.current = merged;
    onRemoteRef.current(merged, changes);
  };

  const push = async (s: ServerSession) => {
    const st = state.current;
    if (!st.base) return;
    for (let attempt = 0; attempt < 3; attempt++) {
      const snapshot = latest.current;
      const pending = diffTrees(st.base, snapshot);
      if (!pending.length) return;
      try {
        st.version = (await api.push(s, st.version, pending)).version;
        st.base = snapshot;
        return;
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) await pull(s);
        else throw e;
      }
    }
  };

  const sync = async (s: ServerSession) => {
    try {
      const ran = await run.current(async () => {
        if (canEdit) {
          setStatus('saving');
          await push(s);
        }
        await pull(s);
      });
      if (ran) {
        const st = state.current;
        setStatus(st.base && diffTrees(st.base, latest.current).length && canEdit ? 'saving' : 'saved');
      }
    } catch (e) {
      setStatus(e instanceof ApiError ? 'error' : 'offline');
    }
  };

  // Push shortly after local edits.
  useEffect(() => {
    if (!session || !canEdit || !state.current.base || tree === state.current.base) return;
    setStatus('saving');
    const handle = setTimeout(() => void sync(session), PUSH_DELAY);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, session, canEdit]);

  // Poll for other people's changes.
  useEffect(() => {
    if (!session) return;
    const handle = setInterval(() => void sync(session), POLL_INTERVAL);
    return () => clearInterval(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, canEdit]);

  return status;
}
