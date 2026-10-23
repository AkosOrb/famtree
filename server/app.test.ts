import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { updatePerson } from '../src/model/operations';
import { sampleTree } from '../src/model/sample';
import { applyChanges, diffTrees } from '../src/sync/changes';
import { REDACTED_NAME } from '../src/model/privacy';
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

async function signUp(app: ReturnType<typeof setup>, email = 'o@b.hu') {
  const agent = request.agent(app);
  await agent
    .post('/api/auth/register')
    .send({ email, name: 'O', password: 'titkosjelszo', acceptPrivacy: true })
    .expect(200);
  return agent;
}

const personNamed = (
  tree: { persons: Record<string, { id: string; firstName: string; lastName: string }> },
  first: string,
) => Object.values(tree.persons).find((p) => p.firstName === first);

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
    // Accepting the privacy notice is required.
    await agent
      .post('/api/auth/register')
      .send({ email: 'a@b.hu', name: 'Ákos', password: 'titkosjelszo' })
      .expect(400);
    const reg = await agent
      .post('/api/auth/register')
      .send({ email: 'A@b.hu', name: 'Ákos', password: 'titkosjelszo', acceptPrivacy: true })
      .expect(200);
    expect(reg.headers['set-cookie'][0]).toMatch(/HttpOnly/);
    await agent
      .post('/api/auth/register')
      .send({ email: 'a@b.hu', name: 'Más', password: 'titkosjelszo', acceptPrivacy: true })
      .expect(409);

    const { id } = (await agent.post('/api/trees').send({ name: 'Saját', tree: sampleTree() }).expect(201)).body;
    const list = await agent.get('/api/trees').expect(200);
    expect(list.body.map((t: { id: string }) => t.id)).toEqual([id]);
    // The owner needs no key.
    expect((await agent.get(`/api/trees/${id}`).expect(200)).body.role).toBe('owner');

    await agent.post('/api/auth/logout').expect(204);
    expect((await agent.get('/api/auth/me').expect(200)).body).toBeNull();
    await agent.get(`/api/trees/${id}`).expect(403);
    await agent.post('/api/auth/login').send({ email: 'a@b.hu', password: 'rossz-jelszo' }).expect(401);
    await agent
      .post('/api/auth/login')
      .send({ email: 'a@b.hu', password: 'titkosjelszo', acceptPrivacy: true })
      .expect(200);
    expect((await agent.get('/api/auth/me').expect(200)).body.name).toBe('Ákos');
  });

  it('lets the owner revoke links by rotating keys', async () => {
    const app = setup();
    const owner = request.agent(app);
    await owner
      .post('/api/auth/register')
      .send({ email: 'o@b.hu', name: 'O', password: 'titkosjelszo', acceptPrivacy: true });
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

  it('sends security headers', async () => {
    const app = setup();
    const res = await request(app).get('/api/auth/me').expect(200);
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('rejects cross-site writes', async () => {
    const app = setup();
    await request(app)
      .post('/api/trees')
      .set('Origin', 'https://gonosz.example')
      .send({ name: 'X', tree: sampleTree() })
      .expect(403);
    const host = await request(app)
      .post('/api/trees')
      .set('Host', 'famtree.example')
      .set('Origin', 'https://famtree.example')
      .send({ name: 'X', tree: sampleTree() });
    expect(host.status).toBe(201);
  });

  it('strips unknown fields from stored records', async () => {
    const app = setup();
    const tree = sampleTree();
    const [first] = Object.keys(tree.persons);
    const sneaky = {
      ...tree,
      persons: { ...tree.persons, [first]: { ...tree.persons[first], extra: 'x', redacted: true } },
    };
    const { id, editKey } = (await request(app).post('/api/trees').send({ name: 'X', tree: sneaky }).expect(201)).body;
    const loaded = await request(app).get(`/api/trees/${id}`).set('Authorization', `Bearer ${editKey}`).expect(200);
    expect(loaded.body.tree.persons[first]).toEqual(tree.persons[first]);
  });

  it('hides living people and private records from view links', async () => {
    const app = setup();
    const owner = await signUp(app);
    const tree = sampleTree();
    const { id, editKey, viewKey } = (await owner.post('/api/trees').send({ name: 'X', tree }).expect(201)).body;
    const view = `Bearer ${viewKey}`;

    // Defaults: living people redacted for viewers, full data for editors.
    const asViewer = (await request(app).get(`/api/trees/${id}`).set('Authorization', view).expect(200)).body;
    expect(asViewer.privacy).toBeUndefined();
    expect(personNamed(asViewer.tree, 'Gábor')).toBeUndefined();
    expect(personNamed(asViewer.tree, 'János')).toBeDefined(); // 1932–2008
    expect(
      Object.values(asViewer.tree.persons).some((p) => (p as { lastName: string }).lastName === REDACTED_NAME),
    ).toBe(true);
    const asEditor = (await request(app).get(`/api/trees/${id}`).set('Authorization', `Bearer ${editKey}`)).body;
    expect(personNamed(asEditor.tree, 'Gábor')).toBeDefined();
    expect(asEditor.privacy.hideLiving).toBe(true);
    expect(asEditor.canSetPrivacy).toBe(false);

    // Only the owner changes settings of an owned tree.
    const open = { hideLiving: false, hidePhotos: false, hideNotes: true };
    await request(app).put(`/api/trees/${id}/privacy`).set('Authorization', `Bearer ${editKey}`).send(open).expect(403);
    await owner.put(`/api/trees/${id}/privacy`).send({ hideLiving: 'nem' }).expect(400);
    await owner.put(`/api/trees/${id}/privacy`).send(open).expect(200);
    const opened = (await request(app).get(`/api/trees/${id}`).set('Authorization', view)).body;
    expect(personNamed(opened.tree, 'Gábor')).toBeDefined();

    // A record marked private stays hidden, also in incremental changes.
    const gabor = personNamed(asEditor.tree, 'Gábor')!;
    const changes = diffTrees(tree, updatePerson(tree, gabor.id, { private: true, notes: 'titok' }));
    await owner.post(`/api/trees/${id}/changes`).send({ baseVersion: 1, changes }).expect(200);
    const since = (await request(app).get(`/api/trees/${id}/changes?since=1`).set('Authorization', view)).body;
    expect(since.changes[0].value).toEqual({
      id: gabor.id,
      firstName: '',
      lastName: REDACTED_NAME,
      gender: 'unknown',
      redacted: true,
    });
  });

  it('lets editors of an unowned tree set privacy', async () => {
    const app = setup();
    const { id, editKey } = (await request(app).post('/api/trees').send({ name: 'X', tree: sampleTree() })).body;
    const loaded = (await request(app).get(`/api/trees/${id}`).set('Authorization', `Bearer ${editKey}`)).body;
    expect(loaded.canSetPrivacy).toBe(true);
    await request(app)
      .put(`/api/trees/${id}/privacy`)
      .set('Authorization', `Bearer ${editKey}`)
      .send({ hideLiving: true, hidePhotos: true, hideNotes: true })
      .expect(200);
  });

  it('asks clients to reload once the change log is pruned', async () => {
    db = openDatabase(':memory:');
    const store = new TreeStore(db);
    const app = createApp(store, new UserStore(db));
    const tree = sampleTree();
    const { id, editKey } = (await request(app).post('/api/trees').send({ name: 'X', tree })).body;
    const edit = `Bearer ${editKey}`;
    const someone = Object.keys(tree.persons)[0];
    const changes = diffTrees(tree, updatePerson(tree, someone, { notes: 'törlendő' }));
    await request(app).post(`/api/trees/${id}/changes`).set('Authorization', edit).send({ baseVersion: 1, changes });
    store.pruneChangeLog(0);
    await request(app).get(`/api/trees/${id}/changes?since=1`).set('Authorization', edit).expect(410);
    // Up-to-date clients are unaffected.
    await request(app).get(`/api/trees/${id}/changes?since=2`).set('Authorization', edit).expect(200);
  });

  it('changes the password and signs out other sessions', async () => {
    const app = setup();
    const first = await signUp(app);
    const second = request.agent(app);
    await second.post('/api/auth/login').send({ email: 'o@b.hu', password: 'titkosjelszo' }).expect(200);

    await first
      .post('/api/account/password')
      .send({ currentPassword: 'rossz', newPassword: 'ujjelszo123' })
      .expect(403);
    await first
      .post('/api/account/password')
      .send({ currentPassword: 'titkosjelszo', newPassword: 'rövid' })
      .expect(400);
    await first
      .post('/api/account/password')
      .send({ currentPassword: 'titkosjelszo', newPassword: 'ujjelszo123' })
      .expect(200);
    expect((await first.get('/api/auth/me')).body?.email).toBe('o@b.hu');
    expect((await second.get('/api/auth/me')).body).toBeNull();
    await second.post('/api/auth/login').send({ email: 'o@b.hu', password: 'ujjelszo123' }).expect(200);

    await second.post('/api/account/logout-all').expect(204);
    expect((await first.get('/api/auth/me')).body).toBeNull();
  });

  it('exports and deletes an account with its trees', async () => {
    const app = setup();
    const owner = await signUp(app);
    const { id, viewKey } = (await owner.post('/api/trees').send({ name: 'Saját', tree: sampleTree() })).body;

    const exported = (await owner.get('/api/account/export').expect(200)).body;
    expect(exported.account.email).toBe('o@b.hu');
    expect(exported.account.privacyAcceptedAt).toBeTruthy();
    expect(exported.trees[0].id).toBe(id);
    expect(Object.keys(exported.trees[0].tree.persons).length).toBeGreaterThan(0);
    await request(app).get('/api/account/export').expect(401);

    await owner.delete('/api/account').send({ password: 'rossz' }).expect(403);
    await owner.delete('/api/account').send({ password: 'titkosjelszo' }).expect(204);
    await request(app).get(`/api/trees/${id}`).set('Authorization', `Bearer ${viewKey}`).expect(404);
    await owner.post('/api/auth/login').send({ email: 'o@b.hu', password: 'titkosjelszo' }).expect(401);
  });
});
