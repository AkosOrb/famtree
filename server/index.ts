import express from 'express';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createApp } from './app';
import { TreeStore } from './store';

const port = Number(process.env.PORT ?? 3001);
const dbFile = resolve(process.env.DB_FILE ?? 'data/famtree.db');
mkdirSync(dirname(dbFile), { recursive: true });

const store = new TreeStore(dbFile);
const app = createApp(store);

// In production the same server also serves the built front end.
const dist = resolve('dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
}

app.listen(port, () => console.log(`famtree szerver: http://localhost:${port} (adatbázis: ${dbFile})`));
