import express, { type NextFunction, type Request, type Response } from 'express';
import { isValidChange } from '../src/sync/changes';
import type { FamilyTree } from '../src/model/types';
import type { Role, TreeStore } from './store';
import type { User, UserStore } from './users';

/**
 * REST API. A tree can be reached two ways:
 * - its owner's account (session cookie), or
 * - a capability key ("Authorization: Bearer <key>"): an edit key or a view
 *   key. The client keeps keys in the URL fragment so they never reach logs.
 */

const MAX_CHANGES = 20000;
const COOKIE = 'famtree_session';
const LOGIN_LIMIT = 10; // attempts per IP per minute

type Authed = Request<{ id: string }> & { role?: Role; user?: User | null };

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

const canEdit = (role: Role | undefined) => role === 'owner' || role === 'editor';

export function createApp(trees: TreeStore, users: UserStore) {
  const app = express();
  app.use(express.json({ limit: '100mb' }));
  app.use((req: Authed, _res, next) => {
    req.user = users.userForSession(readCookie(req, COOKIE));
    next();
  });

  // --- Accounts ---------------------------------------------------------

  const attempts = new Map<string, { count: number; reset: number }>();
  const rateLimit = (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip ?? 'unknown';
    const now = Date.now();
    const entry = attempts.get(ip);
    if (!entry || entry.reset < now) attempts.set(ip, { count: 1, reset: now + 60_000 });
    else if (++entry.count > LOGIN_LIMIT)
      return res.status(429).json({ error: 'Túl sok próbálkozás, várj egy percet.' });
    next();
  };

  const startSession = (req: Request, res: Response, user: User) => {
    const { token, expires } = users.createSession(user.id);
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: req.secure, expires, path: '/' });
    res.json(user);
  };

  app.post('/api/auth/register', rateLimit, async (req, res) => {
    const { email, name, password } = req.body ?? {};
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.length > 200) {
      return res.status(400).json({ error: 'Érvénytelen e-mail cím.' });
    }
    if (typeof name !== 'string' || !name.trim() || name.length > 100) {
      return res.status(400).json({ error: 'Add meg a neved.' });
    }
    if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
      return res.status(400).json({ error: 'A jelszó legalább 8 karakter legyen.' });
    }
    const user = await users.register(email, name, password);
    if (!user) return res.status(409).json({ error: 'Ezzel az e-mail címmel már van fiók.' });
    startSession(req, res, user);
  });

  app.post('/api/auth/login', rateLimit, async (req, res) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Hiányzó adatok.' });
    }
    const user = await users.verify(email, password);
    if (!user) return res.status(401).json({ error: 'Hibás e-mail cím vagy jelszó.' });
    startSession(req, res, user);
  });

  app.post('/api/auth/logout', (req, res) => {
    const token = readCookie(req, COOKIE);
    if (token) users.deleteSession(token);
    res.clearCookie(COOKIE, { path: '/' });
    res.status(204).end();
  });

  // Answers 200 either way so a signed-out visitor does not produce errors.
  app.get('/api/auth/me', (req: Authed, res) => {
    res.json(req.user ?? null);
  });

  // --- Trees ------------------------------------------------------------

  const auth = (need: 'view' | 'edit' | 'own') => (req: Authed, res: Response, next: NextFunction) => {
    const key = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!trees.exists(req.params.id)) return res.status(404).json({ error: 'A családfa nem található.' });
    const role = trees.authorize(req.params.id, key, req.user?.id);
    const allowed = need === 'view' ? !!role : need === 'edit' ? canEdit(role ?? undefined) : role === 'owner';
    if (!allowed) return res.status(403).json({ error: 'Nincs jogosultság.' });
    req.role = role!;
    next();
  };

  app.get('/api/trees', (req: Authed, res) => {
    if (!req.user) return res.status(401).json({ error: 'Nincs bejelentkezve.' });
    res.json(trees.listByOwner(req.user.id));
  });

  app.post('/api/trees', (req: Authed, res) => {
    const { name, tree } = req.body ?? {};
    const t = tree as FamilyTree | undefined;
    if (typeof name !== 'string' || !name.trim() || name.length > 200) {
      return res.status(400).json({ error: 'Hiányzó vagy érvénytelen név.' });
    }
    const records = [
      ...Object.values(t?.persons ?? {}).map((value) => ({ kind: 'person', id: value?.id, value })),
      ...Object.values(t?.unions ?? {}).map((value) => ({ kind: 'union', id: value?.id, value })),
    ];
    if (!t || t.version !== 1 || !records.every(isValidChange)) {
      return res.status(400).json({ error: 'Érvénytelen családfa.' });
    }
    res.status(201).json(trees.create(name.trim(), t, req.user?.id ?? null));
  });

  app.get('/api/trees/:id', auth('view'), (req: Authed, res) => {
    const { meta, tree } = trees.load(req.params.id);
    res.json({ ...meta, role: req.role, tree });
  });

  app.get('/api/trees/:id/changes', auth('view'), (req: Authed, res) => {
    const since = Number(req.query.since);
    if (!Number.isInteger(since) || since < 0) return res.status(400).json({ error: 'Érvénytelen verzió.' });
    res.json(trees.changesSince(req.params.id, since));
  });

  app.post('/api/trees/:id/changes', auth('edit'), (req: Authed, res) => {
    const { baseVersion, changes } = req.body ?? {};
    if (!Number.isInteger(baseVersion) || !Array.isArray(changes) || changes.length > MAX_CHANGES) {
      return res.status(400).json({ error: 'Érvénytelen kérés.' });
    }
    if (!changes.every(isValidChange)) return res.status(400).json({ error: 'Érvénytelen változás.' });
    const version = trees.applyChanges(req.params.id, baseVersion, changes);
    if (version === null) {
      return res.status(409).json({ error: 'Közben más is módosított.', version: trees.meta(req.params.id).version });
    }
    res.json({ version });
  });

  app.get('/api/trees/:id/share', auth('edit'), (req: Authed, res) => {
    res.json({ viewKey: trees.viewKey(req.params.id) });
  });

  app.post('/api/trees/:id/keys', auth('own'), (req: Authed, res) => {
    const which = req.body?.which;
    if (which !== 'edit' && which !== 'view') return res.status(400).json({ error: 'Érvénytelen kulcstípus.' });
    res.json({ key: trees.rotateKey(req.params.id, which) });
  });

  app.patch('/api/trees/:id', auth('edit'), (req: Authed, res) => {
    const { name } = req.body ?? {};
    if (typeof name !== 'string' || !name.trim() || name.length > 200) {
      return res.status(400).json({ error: 'Érvénytelen név.' });
    }
    trees.rename(req.params.id, name.trim());
    res.json(trees.meta(req.params.id));
  });

  app.delete('/api/trees/:id', auth('own'), (req: Authed, res) => {
    trees.delete(req.params.id);
    res.status(204).end();
  });

  return app;
}
