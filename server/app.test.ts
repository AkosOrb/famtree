import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { updatePerson } from '../src/model/operations';
import { sampleTree } from '../src/model/sample';
import { applyChanges, diffTrees } from '../src/sync/changes';
import { createApp } from './app';
import type Database from 'better-sqlite3';
import { openDatabase, TreeStore } from './store';
import { UserStore } from './users';

let db: Database.Database;
afterEach(() => db?.close());

function setup() {
  db = openDatabase(':memory:');
  return createApp(new TreeStore(db), new UserStore(db));
}

describe('API', () => {
  it('creates, loads, edits and syncs a tree', async () => {
    const app = setup();
    const tree = sampleTree();
    const created = await request(app).post('/api/trees').send({ name: 'Kovács család', tree }).expect(201);
    const { id, editKey, viewKey } = created.body;
    const edit = `Bearer ${editKey}`;

    const loaded = await request(app).get(`/api/trees/${id}`).set('Authorization', edit).expect(200);
    expect(loaded.body.role).toBe('editor');
    expect(Object.keys(loaded.body.tree.persons)).toHaveLength(Object.keys(tree.persons).length);

    const someone = Object.keys(tree.persons)[0];
    const changes = diffTrees(tree, updatePerson(tree, someone, { notes: 'szerveren' }));
    const pushed = await request(app)
      .post(`/api/trees/${id}/changes`)
      .set('Authorization', edit)
      .send({ baseVersion: 1, changes })
      .expect(200);
    expect(pushed.body.version).toBe(2);

    // A stale client gets a conflict and can catch up incrementally.
    await request(app)
      .post(`/api/trees/${id}/changes`)
      .set('Authorization', edit)
      .send({ baseVersion: 1, changes })
      .expect(409);
    const since = await request(app)
      .get(`/api/trees/${id}/changes?since=1`)
      .set('Authorization', `Bearer ${viewKey}`)
      .expect(200);
    expect(since.body.version).toBe(2);
    expect(applyChanges(tree, since.body.changes).persons[someone].notes).toBe('szerveren');
  });

  it('enforces roles', async () => {
    const app = setup();
    const { id, viewKey } = (await request(app).post('/api/trees').send({ name: 'X', tree: sampleTree() })).body;
    await request(app).get(`/api/trees/${id}`).expect(403);
    await request(app).get(`/api/trees/${id}`).set('Authorization', 'Bearer rossz').expect(403);
    const viewer = await request(app).get(`/api/trees/${id}`).set('Authorization', `Bearer ${viewKey}`).expect(200);
    expect(viewer.body.role).toBe('viewer');
    await request(app)
      .post(`/api/trees/${id}/changes`)
      .set('Authorization', `Bearer ${viewKey}`)
      .send({ baseVersion: 1, changes: [] })
      .expect(403);
    await request(app).get(`/api/trees/${id}/share`).set('Authorization', `Bearer ${viewKey}`).expect(403);
    await request(app).get('/api/trees/nincs').set('Authorization', `Bearer ${viewKey}`).expect(404);
  });

  it('rejects malformed changes', async () => {
    const app = setup();
    const { id, editKey } = (await request(app).post('/api/trees').send({ name: 'X', tree: sampleTree() })).body;
    await request(app)
      .post(`/api/trees/${id}/changes`)
      .set('Authorization', `Bearer ${editKey}`)
      .send({ baseVersion: 1, changes: [{ kind: 'person', id: 'a', value: { id: 'a', gender: 'robot' } }] })
      .expect(400);
  });

  it('registers, logs in and lists owned trees', async () => {
    const app = setup();
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send({ email: 'a@b.hu', name: 'Ákos', password: 'rövid' }).expect(400);
    const reg = await agent
      .post('/api/auth/register')
      .send({ email: 'A@b.hu', name: 'Ákos', password: 'titkosjelszo' })
      .expect(200);
    expect(reg.headers['set-cookie'][0]).toMatch(/HttpOnly/);
    await agent.post('/api/auth/register').send({ email: 'a@b.hu', name: 'Más', password: 'titkosjelszo' }).expect(409);

    const { id } = (await agent.post('/api/trees').send({ name: 'Saját', tree: sampleTree() }).expect(201)).body;
    const list = await agent.get('/api/trees').expect(200);
    expect(list.body.map((t: { id: string }) => t.id)).toEqual([id]);
    // The owner needs no key.
    expect((await agent.get(`/api/trees/${id}`).expect(200)).body.role).toBe('owner');

    await agent.post('/api/auth/logout').expect(204);
    expect((await agent.get('/api/auth/me').expect(200)).body).toBeNull();
    await agent.get(`/api/trees/${id}`).expect(403);
    await agent.post('/api/auth/login').send({ email: 'a@b.hu', password: 'rossz-jelszo' }).expect(401);
    await agent.post('/api/auth/login').send({ email: 'a@b.hu', password: 'titkosjelszo' }).expect(200);
    expect((await agent.get('/api/auth/me').expect(200)).body.name).toBe('Ákos');
  });

  it('lets the owner revoke links by rotating keys', async () => {
    const app = setup();
    const owner = request.agent(app);
    await owner.post('/api/auth/register').send({ email: 'o@b.hu', name: 'O', password: 'titkosjelszo' });
    const { id, editKey, viewKey } = (await owner.post('/api/trees').send({ name: 'X', tree: sampleTree() })).body;

    // Key holders cannot rotate or delete.
    await request(app)
      .post(`/api/trees/${id}/keys`)
      .set('Authorization', `Bearer ${editKey}`)
      .send({ which: 'view' })
      .expect(403);
    await request(app).delete(`/api/trees/${id}`).set('Authorization', `Bearer ${editKey}`).expect(403);

    const fresh = (await owner.post(`/api/trees/${id}/keys`).send({ which: 'view' }).expect(200)).body.key;
    await request(app).get(`/api/trees/${id}`).set('Authorization', `Bearer ${viewKey}`).expect(403);
    await request(app).get(`/api/trees/${id}`).set('Authorization', `Bearer ${fresh}`).expect(200);
    await owner.delete(`/api/trees/${id}`).expect(204);
  });
});
