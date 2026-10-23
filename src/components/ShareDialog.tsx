import { useEffect, useState } from 'react';
import { LIVING_YEARS, type PrivacySettings } from '../model/privacy';
import { api, shareUrl, type Role, type ServerSession } from '../sync/api';
import { askConfirm } from './ConfirmDialog';

interface Props {
  session: ServerSession | null;
  role: Role | null;
  signedIn: boolean;
  onUpload: (name: string) => Promise<void>;
  /** Called when this tab's own edit key was replaced. */
  onSessionKey: (key: string) => void;
  /** What view-link visitors may see; undefined for viewers, who cannot see the settings. */
  privacy?: PrivacySettings;
  canSetPrivacy: boolean;
  onPrivacy: (settings: PrivacySettings) => void;
  onClose: () => void;
}

export function ShareDialog(props: Props) {
  const { session, role, signedIn, onUpload, onSessionKey, privacy, canSetPrivacy, onPrivacy, onClose } = props;
  const [name, setName] = useState('Családfám');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewKey, setViewKey] = useState<string | null>(null);
  // The owner may have opened the tree without a key; a fresh one is made on request.
  const [editKey, setEditKey] = useState<string | undefined>(session?.key);
  const isOwner = role === 'owner';
  useEffect(() => setEditKey(session?.key), [session?.key]);

  useEffect(() => {
    if (!session || role === 'viewer') return;
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

  const rotate = async (which: 'edit' | 'view') => {
    if (!session) return;
    const warning =
      which === 'edit'
        ? 'Új szerkesztői link készül, a régi szerkesztői link azonnal megszűnik. Folytatod?'
        : 'Új csak olvasható link készül, a régi azonnal megszűnik. Folytatod?';
    if ((which === 'view' || editKey) && !(await askConfirm(warning, 'Új link'))) return;
    try {
      const { key } = await api.rotateKey(session, which);
      if (which === 'edit') {
        setEditKey(key);
        // Keep this tab working if it was using the old key.
        if (session.key) onSessionKey(key);
      } else setViewKey(key);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nem sikerült új linket készíteni.');
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
            {!signedIn && (
              <p className="muted">
                Tipp: ha előbb bejelentkezel, a fa a fiókodhoz kerül, és később a „Saját családfáim” listából is
                megnyithatod.
              </p>
            )}
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
            {editKey ? (
              <LinkField
                label="Szerkesztői link"
                hint="Aki ismeri, szerkesztheti a fát."
                url={shareUrl(session.treeId, editKey)}
                onRotate={isOwner ? () => rotate('edit') : undefined}
              />
            ) : (
              isOwner && <button onClick={() => rotate('edit')}>Szerkesztői link készítése</button>
            )}
            {viewKey && (
              <LinkField
                label="Csak olvasható link"
                hint="Aki ismeri, megnézheti a fát, de nem módosíthatja."
                url={shareUrl(session.treeId, viewKey)}
                onRotate={isOwner ? () => rotate('view') : undefined}
              />
            )}
            {isOwner && (
              <p className="muted">
                Tulajdonosként bejelentkezve link nélkül is eléred a fát. Az „Új link” a régit azonnal érvényteleníti.
              </p>
            )}
            {privacy && (
              <PrivacySettingsForm
                settings={privacy}
                disabled={!canSetPrivacy}
                onChange={async (next) => {
                  setError(null);
                  try {
                    onPrivacy(await api.setPrivacy(session, next));
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'A beállítás nem menthető.');
                  }
                }}
              />
            )}
          </>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}

function LinkField({
  label,
  hint,
  url,
  onRotate,
}: {
  label: string;
  hint: string;
  url: string;
  onRotate?: () => void;
}) {
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
          {onRotate && <button onClick={onRotate}>Új link</button>}
        </div>
      </label>
      <small>{hint}</small>
    </div>
  );
}

const PRIVACY_OPTIONS: { key: keyof PrivacySettings; label: string; hint: string }[] = [
  {
    key: 'hideLiving',
    label: 'Élő személyek elrejtése',
    hint: `Akinek nincs halálozási éve, és ${LIVING_YEARS} évnél fiatalabb (vagy nem ismert a születési éve), „Rejtett személy”-ként jelenik meg.`,
  },
  { key: 'hidePhotos', label: 'Fényképek elrejtése', hint: 'A fényképek nem kerülnek át.' },
  { key: 'hideNotes', label: 'Megjegyzések elrejtése', hint: 'A megjegyzések nem kerülnek át.' },
];

function PrivacySettingsForm({
  settings,
  disabled,
  onChange,
}: {
  settings: PrivacySettings;
  disabled: boolean;
  onChange: (settings: PrivacySettings) => void;
}) {
  return (
    <fieldset className="privacy-settings" disabled={disabled}>
      <legend className="section-title">Adatvédelem a csak olvasható linken</legend>
      {PRIVACY_OPTIONS.map((o) => (
        <label key={o.key} className="checkbox">
          <input
            type="checkbox"
            checked={settings[o.key]}
            onChange={(e) => onChange({ ...settings, [o.key]: e.target.checked })}
          />
          <span>
            {o.label}
            <small>{o.hint}</small>
          </span>
        </label>
      ))}
      <small className="muted">
        {disabled
          ? 'Ezeket csak a fa tulajdonosa módosíthatja.'
          : 'A rejtett adatokat a szerver el sem küldi. Egy-egy személy a saját adatlapján külön is elrejthető. A szerkesztői link mindig a teljes fát mutatja.'}
      </small>
    </fieldset>
  );
}
