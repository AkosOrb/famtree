import { useEffect, useState, type FormEvent } from 'react';
import { api, shareUrl, type TreeSummary, type User } from '../sync/api';
import { askConfirm } from './ConfirmDialog';

interface Props {
  user: User | null;
  currentTreeId?: string;
  onUser: (user: User | null) => void;
  onShowPrivacy: () => void;
  onClose: () => void;
}

export function AccountDialog({ user, currentTreeId, onUser, onShowPrivacy, onClose }: Props) {
  return (
    <div className="dialog-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-label="Fiók">
        <header className="panel-header">
          <h2>{user ? user.name : 'Bejelentkezés'}</h2>
          <button className="icon" onClick={onClose} aria-label="Bezárás">
            ×
          </button>
        </header>
        {user ? (
          <>
            <MyTrees user={user} currentTreeId={currentTreeId} onLogout={() => onUser(null)} />
            <AccountSecurity onUser={onUser} onShowPrivacy={onShowPrivacy} />
          </>
        ) : (
          <AuthForm onUser={onUser} onShowPrivacy={onShowPrivacy} />
        )}
      </div>
    </div>
  );
}

function AuthForm({ onUser, onShowPrivacy }: { onUser: (u: User) => void; onShowPrivacy: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [form, setForm] = useState({ email: '', name: '', password: '', acceptPrivacy: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onUser(
        mode === 'login'
          ? await api.login(form.email, form.password)
          : await api.register(form.email, form.name, form.password, form.acceptPrivacy),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hiba történt.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="person-form" onSubmit={submit}>
      <div className="segmented">
        <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
          Bejelentkezés
        </button>
        <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>
          Regisztráció
        </button>
      </div>
      <label>
        E-mail cím
        <input
          type="email"
          autoComplete="email"
          required
          autoFocus
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
      </label>
      {mode === 'register' && (
        <label>
          Név
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
      )}
      <label>
        Jelszó{mode === 'register' && ' (legalább 8 karakter)'}
        <input
          type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          required
          minLength={mode === 'register' ? 8 : undefined}
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
      </label>
      {mode === 'register' && (
        <label className="checkbox">
          <input
            type="checkbox"
            required
            checked={form.acceptPrivacy}
            onChange={(e) => setForm({ ...form, acceptPrivacy: e.target.checked })}
          />
          <span>
            Elolvastam és elfogadom az{' '}
            <button type="button" className="link" onClick={onShowPrivacy}>
              adatkezelési tájékoztatót
            </button>
            .
          </span>
        </label>
      )}
      <button type="submit" className="primary" disabled={busy}>
        {mode === 'login' ? 'Bejelentkezés' : 'Fiók létrehozása'}
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

function MyTrees({ user, currentTreeId, onLogout }: { user: User; currentTreeId?: string; onLogout: () => void }) {
  const [trees, setTrees] = useState<TreeSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .myTrees()
      .then(setTrees)
      .catch((e: Error) => setError(e.message));
  }, []);

  const remove = async (t: TreeSummary) => {
    if (
      !(await askConfirm(`Biztosan törlöd a(z) „${t.name}” családfát a szerverről? Ez nem vonható vissza.`, 'Törlés'))
    )
      return;
    try {
      await api.deleteTree(t.id);
      setTrees((list) => list?.filter((x) => x.id !== t.id) ?? null);
      if (t.id === currentTreeId) window.location.href = window.location.pathname;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'A törlés nem sikerült.');
    }
  };

  return (
    <>
      <p className="muted">{user.email}</p>
      <h3 className="section-title">Saját családfáim</h3>
      {trees === null && !error && <p className="muted">Betöltés…</p>}
      {trees?.length === 0 && (
        <p className="muted">Még nincs feltöltött családfád. A „Megosztás” gombbal töltheted fel a jelenlegit.</p>
      )}
      {trees && trees.length > 0 && (
        <ul className="tree-list">
          {trees.map((t) => (
            <li key={t.id} className={t.id === currentTreeId ? 'current' : ''}>
              <a href={shareUrl(t.id)}>{t.name}</a>
              <small>{new Date(t.updatedAt).toLocaleString('hu')}</small>
              <button className="danger" onClick={() => remove(t)}>
                Törlés
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="button-row">
        <button onClick={() => (window.location.href = window.location.pathname)}>Helyi fa megnyitása</button>
        <button
          onClick={async () => {
            await api.logout().catch(() => undefined);
            onLogout();
          }}
        >
          Kijelentkezés
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </>
  );
}

function download(data: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Password change, data export, signing out everywhere and account deletion. */
function AccountSecurity({ onUser, onShowPrivacy }: { onUser: (u: User | null) => void; onShowPrivacy: () => void }) {
  const [form, setForm] = useState<'password' | 'delete' | null>(null);
  const [fields, setFields] = useState({ current: '', next: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await task();
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : 'Hiba történt.', error: true });
    } finally {
      setBusy(false);
    }
  };

  const open = (which: 'password' | 'delete') => {
    setForm(form === which ? null : which);
    setFields({ current: '', next: '' });
    setMessage(null);
  };

  const changePassword = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      onUser(await api.changePassword(fields.current, fields.next));
      setForm(null);
      setMessage({ text: 'A jelszó megváltozott, a többi eszközön kijelentkeztettünk.' });
    });
  };

  const deleteAccount = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const ok = await askConfirm(
        'A fiókod és az összes hozzá tartozó, szerverre feltöltött családfa véglegesen törlődik, a megosztott linkek is megszűnnek. Ez nem vonható vissza.',
        'Fiók törlése',
      );
      if (!ok) return;
      await api.deleteAccount(fields.current);
      onUser(null);
      window.location.href = window.location.pathname;
    });
  };

  return (
    <>
      <h3 className="section-title">Biztonság és adatvédelem</h3>
      <div className="button-row wrap">
        <button onClick={() => open('password')} className={form === 'password' ? 'active' : ''}>
          Jelszó módosítása
        </button>
        <button
          disabled={busy}
          onClick={() => void run(async () => download(await api.exportAccount(), 'famtree-adataim.json'))}
        >
          Adataim letöltése
        </button>
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              if (!(await askConfirm('Minden eszközön kijelentkeztetünk, ezen is. Folytatod?', 'Kijelentkezés')))
                return;
              await api.logoutAll();
              onUser(null);
            })
          }
        >
          Kijelentkezés mindenhol
        </button>
        <button className="link" onClick={onShowPrivacy}>
          Adatkezelési tájékoztató
        </button>
      </div>

      {form === 'password' && (
        <form className="person-form" onSubmit={changePassword}>
          <label>
            Jelenlegi jelszó
            <input
              type="password"
              autoComplete="current-password"
              required
              value={fields.current}
              onChange={(e) => setFields({ ...fields, current: e.target.value })}
            />
          </label>
          <label>
            Új jelszó (legalább 8 karakter)
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={fields.next}
              onChange={(e) => setFields({ ...fields, next: e.target.value })}
            />
          </label>
          <button type="submit" className="primary" disabled={busy}>
            Jelszó módosítása
          </button>
        </form>
      )}

      {form === 'delete' ? (
        <form className="person-form" onSubmit={deleteAccount}>
          <p className="muted">Előtte érdemes letölteni az adataidat. A böngészőben tárolt helyi fát ez nem érinti.</p>
          <label>
            Jelszó a megerősítéshez
            <input
              type="password"
              autoComplete="current-password"
              required
              value={fields.current}
              onChange={(e) => setFields({ ...fields, current: e.target.value })}
            />
          </label>
          <div className="button-row">
            <button type="button" onClick={() => setForm(null)}>
              Mégse
            </button>
            <button type="submit" className="danger" disabled={busy}>
              Fiók végleges törlése
            </button>
          </div>
        </form>
      ) : (
        <button className="danger" onClick={() => open('delete')}>
          Fiók törlése…
        </button>
      )}
      {message && <p className={message.error ? 'error' : 'muted'}>{message.text}</p>}
    </>
  );
}
