import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { updatePerson } from '../src/model/operations';
import { sampleTree } from '../src/model/sample';
import { applyChanges, diffTrees } from '../src/sync/changes';
import { createApp } from './app';
import { TreeStore } from './store';

let store: TreeStore;
afterEach(() => store?.close());

function setup() {
  store = new TreeStore(':memory:');
  return createApp(store);
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
    await request(app).post(`/api/trees/${id}/changes`).set('Authorization', edit).send({ baseVersion: 1, changes }).expect(409);
    const since = await request(app).get(`/api/trees/${id}/changes?since=1`).set('Authorization', `Bearer ${viewKey}`).expect(200);
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
});
