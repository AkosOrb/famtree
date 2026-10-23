import { useSyncExternalStore } from 'react';

/**
 * In-page replacement for window.confirm(), which embedded or sandboxed
 * frames may silently refuse. Call askConfirm() anywhere; <ConfirmHost/>
 * (mounted once in App) renders the pending question.
 */

interface Pending {
  message: string;
  confirmLabel: string;
  resolve: (ok: boolean) => void;
}

let pending: Pending | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function askConfirm(message: string, confirmLabel = 'Igen'): Promise<boolean> {
  pending?.resolve(false);
  return new Promise((resolve) => {
    pending = { message, confirmLabel, resolve };
    emit();
  });
}

function answer(ok: boolean) {
  const p = pending;
  pending = null;
  emit();
  p?.resolve(ok);
}

export function ConfirmHost() {
  const current = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => pending,
  );
  if (!current) return null;
  return (
    <div className="dialog-backdrop" onClick={(e) => e.target === e.currentTarget && answer(false)}>
      <div className="dialog" role="alertdialog" aria-label="Megerősítés">
        <p>{current.message}</p>
        <div className="button-row">
          <button onClick={() => answer(false)} autoFocus>
            Mégse
          </button>
          <button className="primary" onClick={() => answer(true)}>
            {current.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
