import express, { type NextFunction, type Request, type Response } from 'express';
import { isPrivacySettings, redactPerson, redactTree, storyVisible } from '../src/model/privacy';
import { isValidChange, isValidTree, sanitizeChange, sanitizeTree, type Change } from '../src/sync/changes';
import { rateLimiter, sameOrigin, securityHeaders } from './security';
import type { Role, TreeStore } from './store';
import type { User, UserStore } from './users';

/**
 * REST API. A tree can be reached two ways:
 * - its owner's account (session cookie), or
 * - a capability key ("Authorization: Bearer <key>"): an edit key or a view
 *   key. The client keeps keys in the URL fragment so they never reach logs.
 * View-key holders get data redacted per the tree's privacy settings.
 */

const MAX_CHANGES = 20000;
const COOKIE = 'famtree_session';
const LOGIN_LIMIT = 10; // attempts per IP per minute
const API_LIMIT = 600; // requests per IP per minute; a syncing tab polls about 12 times a minute
const CREATE_LIMIT = 30; // uploaded trees per IP per hour

type Authed = Request<{ id: string }> & { role?: Role; user?: User | null };

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

const canEdit = (role: Role | undefined) => role === 'owner' || role === 'editor';
const validPassword = (p: unknown): p is string => typeof p === 'string' && p.length >= 8 && p.length <= 200;

export function createApp(trees: TreeStore, users: UserStore) {
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use('/api', rateLimiter(API_LIMIT, 60_000), sameOrigin);
  app.use(express.json({ limit: '100mb' }));
  app.use((req: Authed, _res, next) => {
    req.user = users.userForSession(readCookie(req, COOKIE));
    next();
  });

  // --- Accounts ---------------------------------------------------------

  const rateLimit = rateLimiter(LOGIN_LIMIT, 60_000, 'Túl sok próbálkozás, várj egy percet.');

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
    if (!validPassword(password)) {
      return res.status(400).json({ error: 'A jelszó legalább 8 karakter legyen.' });
    }
    if (req.body.acceptPrivacy !== true) {
      return res.status(400).json({ error: 'A regisztrációhoz el kell fogadnod az adatkezelési tájékoztatót.' });
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

  const signedIn = (req: Authed, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Nincs bejelentkezve.' });
    next();
  };

  app.post('/api/account/password', signedIn, rateLimit, async (req: Authed, res) => {
    const { currentPassword, newPassword } = req.body ?? {};
    if (typeof currentPassword !== 'string' || !(await users.checkPassword(req.user!.id, currentPassword))) {
      return res.status(403).json({ error: 'A jelenlegi jelszó hibás.' });
    }
    if (!validPassword(newPassword)) return res.status(400).json({ error: 'Az új jelszó legalább 8 karakter legyen.' });
    await users.changePassword(req.user!.id, newPassword);
    // Every other device is signed out; this one gets a fresh session.
    startSession(req, res, req.user!);
  });

  app.post('/api/account/logout-all', signedIn, (req: Authed, res) => {
    users.deleteAllSessions(req.user!.id);
    res.clearCookie(COOKIE, { path: '/' });
    res.status(204).end();
  });

  // Data portability: everything stored about the user and their trees, as one JSON file.
  app.get('/api/account/export', signedIn, (req: Authed, res) => {
    const id = req.user!.id;
    const owned = trees.listByOwner(id).map((meta) => ({
      ...meta,
      privacy: trees.privacy(meta.id),
      tree: trees.load(meta.id).tree,
    }));
    res.setHeader('Content-Disposition', 'attachment; filename="famtree-adataim.json"');
    res.json({ exportedAt: new Date().toISOString(), account: users.accountInfo(id), trees: owned });
  });

  // Right to erasure: deletes the account, its sessions and every tree it owns.
  app.delete('/api/account', signedIn, rateLimit, async (req: Authed, res) => {
    const { password } = req.body ?? {};
    if (typeof password !== 'string' || !(await users.checkPassword(req.user!.id, password))) {
      return res.status(403).json({ error: 'Hibás jelszó.' });
    }
    trees.deleteByOwner(req.user!.id);
    users.deleteUser(req.user!.id);
    res.clearCookie(COOKIE, { path: '/' });
    res.status(204).end();
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

  app.post('/api/trees', rateLimiter(CREATE_LIMIT, 3600_000), (req: Authed, res) => {
    const { name, tree } = req.body ?? {};
    if (typeof name !== 'string' || !name.trim() || name.length > 200) {
      return res.status(400).json({ error: 'Hiányzó vagy érvénytelen név.' });
    }
    if (!isValidTree(tree)) return res.status(400).json({ error: 'Érvénytelen családfa.' });
    res.status(201).json(trees.create(name.trim(), sanitizeTree(tree), req.user?.id ?? null));
  });

  app.get('/api/trees/:id', auth('view'), (req: Authed, res) => {
    const { meta, tree } = trees.load(req.params.id);
    const privacy = trees.privacy(req.params.id);
    if (req.role === 'viewer') return res.json({ ...meta, role: req.role, tree: redactTree(tree, privacy) });
    res.json({ ...meta, role: req.role, tree, privacy, canSetPrivacy: canSetPrivacy(req) });
  });

  app.get('/api/trees/:id/changes', auth('view'), (req: Authed, res) => {
    const since = Number(req.query.since);
    if (!Number.isInteger(since) || since < 0) return res.status(400).json({ error: 'Érvénytelen verzió.' });
    const result = trees.changesSince(req.params.id, since);
    if (!result) return res.status(410).json({ error: 'A változásnapló már nem ér vissza eddig, töltsd újra a fát.' });
    if (req.role !== 'viewer') return res.json(result);
    const privacy = trees.privacy(req.params.id);
    const year = new Date().getFullYear();
    // Story visibility depends on its members' current (unredacted) records.
    const persons = result.changes.some((c) => c.kind === 'story' && c.value)
      ? trees.load(req.params.id).tree.persons
      : {};
    const changes = result.changes.map((c): Change => {
      if (c.kind === 'person' && c.value) return { ...c, value: redactPerson(c.value, privacy, year) };
      if (c.kind === 'story' && c.value && !storyVisible(c.value, persons, privacy, year)) return { ...c, value: null };
      return c;
    });
    res.json({ version: result.version, changes });
  });

  // The owner decides; a tree uploaded without an account has no owner, so its editors do.
  const canSetPrivacy = (req: Authed) =>
    req.role === 'owner' || (req.role === 'editor' && !trees.hasOwner(req.params.id));

  app.put('/api/trees/:id/privacy', auth('edit'), (req: Authed, res) => {
    if (!canSetPrivacy(req)) return res.status(403).json({ error: 'Csak a tulajdonos módosíthatja.' });
    if (!isPrivacySettings(req.body)) return res.status(400).json({ error: 'Érvénytelen beállítás.' });
    trees.setPrivacy(req.params.id, req.body);
    res.json(trees.privacy(req.params.id));
  });

  app.post('/api/trees/:id/changes', auth('edit'), (req: Authed, res) => {
    const { baseVersion, changes } = req.body ?? {};
    if (!Number.isInteger(baseVersion) || !Array.isArray(changes) || changes.length > MAX_CHANGES) {
      return res.status(400).json({ error: 'Érvénytelen kérés.' });
    }
    if (!changes.every(isValidChange)) return res.status(400).json({ error: 'Érvénytelen változás.' });
    const version = trees.applyChanges(req.params.id, baseVersion, changes.map(sanitizeChange));
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
