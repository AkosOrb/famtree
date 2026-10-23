import express from 'express';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createApp } from './app';
import { openDatabase, TreeStore } from './store';
import { UserStore } from './users';

const port = Number(process.env.PORT ?? 3001);
const dbFile = resolve(process.env.DB_FILE ?? 'data/famtree.db');
mkdirSync(dirname(dbFile), { recursive: true });

const db = openDatabase(dbFile);
const trees = new TreeStore(db);
const users = new UserStore(db);
const app = createApp(trees, users);

// Retention: expired sessions and old change log entries are removed hourly.
const sweep = () => {
  trees.pruneChangeLog();
  users.pruneSessions();
};
sweep();
setInterval(sweep, 3600_000).unref();
// Behind a reverse proxy (HTTPS termination), trust it so secure cookies and req.ip work.
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);

// In production the same server also serves the built front end.
const dist = resolve('dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
}

app.listen(port, () => console.log(`famtree szerver: http://localhost:${port} (adatbázis: ${dbFile})`));
