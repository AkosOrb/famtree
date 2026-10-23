import { useEffect, useState } from 'react';
import { api, shareUrl, type Role, type ServerSession } from '../sync/api';

interface Props {
  session: ServerSession | null;
  role: Role | null;
  onUpload: (name: string) => Promise<void>;
  onClose: () => void;
}

export function ShareDialog({ session, role, onUpload, onClose }: Props) {
  const [name, setName] = useState('Családfám');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewKey, setViewKey] = useState<string | null>(null);

  useEffect(() => {
    if (!session || role !== 'editor') return;
    api
      .viewKey(session)
      .then((r) => setViewKey(r.viewKey))
      .catch((e: Error) => setError(e.message));
  }, [session, role]);

  const upload = async () => {
    setBusy(true);
    setError(null);
    try {
      await onUpload(name.trim() || 'Családfám');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'A feltöltés nem sikerült.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-label="Megosztás">
        <header className="panel-header">
          <h2>Megosztás</h2>
          <button className="icon" onClick={onClose} aria-label="Bezárás">
            ×
          </button>
        </header>

        {!session ? (
          <>
            <p>
              A családfa most csak ebben a böngészőben van elmentve. Töltsd fel a szerverre, hogy más eszközről is
              elérd, és linkkel megoszthasd.
            </p>
            <label>
              A családfa neve
              <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </label>
            <button className="primary" onClick={upload} disabled={busy}>
              {busy ? 'Feltöltés…' : 'Feltöltés a szerverre'}
            </button>
          </>
        ) : (
          <>
            <LinkField
              label="Szerkesztői link"
              hint="Aki ismeri, szerkesztheti a fát. Ezt a linket tedd el, ezzel tudod később is megnyitni."
              url={shareUrl(session.treeId, session.key)}
            />
            {viewKey && (
              <LinkField
                label="Csak olvasható link"
                hint="Aki ismeri, megnézheti a fát, de nem módosíthatja."
                url={shareUrl(session.treeId, viewKey)}
              />
            )}
          </>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}

function LinkField({ label, hint, url }: { label: string; hint: string; url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="link-field">
      <label>
        {label}
        <div className="row">
          <input readOnly value={url} onFocus={(e) => e.target.select()} />
          <button
            onClick={() => {
              void navigator.clipboard?.writeText(url).then(() => setCopied(true));
            }}
          >
            {copied ? 'Másolva' : 'Másolás'}
          </button>
        </div>
      </label>
      <small>{hint}</small>
    </div>
  );
}
