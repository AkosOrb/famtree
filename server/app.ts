import express, { type NextFunction, type Request, type Response } from 'express';
import { isValidChange } from '../src/sync/changes';
import type { FamilyTree } from '../src/model/types';
import type { Role, TreeStore } from './store';

/**
 * REST API. Access uses capability keys instead of accounts: the creator gets
 * an edit key and a view key, and whoever holds a key has that role. Keys are
 * sent as "Authorization: Bearer <key>"; the client keeps them in the URL
 * fragment so they never reach server logs.
 */

const MAX_CHANGES = 20000;

type Authed = Request<{ id: string }> & { role?: Role };

export function createApp(store: TreeStore) {
  const app = express();
  app.use(express.json({ limit: '20mb' }));

  const auth = (need: Role) => (req: Authed, res: Response, next: NextFunction) => {
    const key = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!store.exists(req.params.id)) return res.status(404).json({ error: 'A családfa nem található.' });
    const role = store.authorize(req.params.id, key);
    if (!role || (need === 'editor' && role !== 'editor')) {
      return res.status(403).json({ error: 'Nincs jogosultság.' });
    }
    req.role = role;
    next();
  };

  app.post('/api/trees', (req, res) => {
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
    res.status(201).json(store.create(name.trim(), t));
  });

  app.get('/api/trees/:id', auth('viewer'), (req: Authed, res) => {
    const { meta, tree } = store.load(req.params.id);
    res.json({ ...meta, role: req.role, tree });
  });

  app.get('/api/trees/:id/changes', auth('viewer'), (req: Authed, res) => {
    const since = Number(req.query.since);
    if (!Number.isInteger(since) || since < 0) return res.status(400).json({ error: 'Érvénytelen verzió.' });
    res.json(store.changesSince(req.params.id, since));
  });

  app.post('/api/trees/:id/changes', auth('editor'), (req: Authed, res) => {
    const { baseVersion, changes } = req.body ?? {};
    if (!Number.isInteger(baseVersion) || !Array.isArray(changes) || changes.length > MAX_CHANGES) {
      return res.status(400).json({ error: 'Érvénytelen kérés.' });
    }
    if (!changes.every(isValidChange)) return res.status(400).json({ error: 'Érvénytelen változás.' });
    const version = store.applyChanges(req.params.id, baseVersion, changes);
    if (version === null) {
      return res.status(409).json({ error: 'Közben más is módosított.', version: store.meta(req.params.id).version });
    }
    res.json({ version });
  });

  app.get('/api/trees/:id/share', auth('editor'), (req: Authed, res) => {
    res.json({ viewKey: store.viewKey(req.params.id) });
  });

  app.delete('/api/trees/:id', auth('editor'), (req: Authed, res) => {
    store.delete(req.params.id);
    res.status(204).end();
  });

  return app;
}
