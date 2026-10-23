import { useEffect, useState, type FormEvent } from 'react';
import { api, shareUrl, type TreeSummary, type User } from '../sync/api';
import { askConfirm } from './ConfirmDialog';

interface Props {
  user: User | null;
  currentTreeId?: string;
  onUser: (user: User | null) => void;
  onClose: () => void;
}

export function AccountDialog({ user, currentTreeId, onUser, onClose }: Props) {
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
          <MyTrees user={user} currentTreeId={currentTreeId} onLogout={() => onUser(null)} />
        ) : (
          <AuthForm
            onUser={(u) => {
              onUser(u);
            }}
          />
        )}
      </div>
    </div>
  );
}

function AuthForm({ onUser }: { onUser: (u: User) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [form, setForm] = useState({ email: '', name: '', password: '' });
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
          : await api.register(form.email, form.name, form.password),
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
