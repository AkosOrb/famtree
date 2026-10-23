import Database from 'better-sqlite3';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Change } from '../src/sync/changes';
import type { FamilyTree } from '../src/model/types';

/**
 * SQLite storage. Persons and unions are stored as one row each, so edits
 * touch only the changed rows; every accepted change set is also appended to
 * a change log, letting clients fetch just what happened since their version.
 */

export type Role = 'owner' | 'editor' | 'viewer';

export interface TreeMeta {
  id: string;
  name: string;
  version: number;
  updatedAt: string;
}

const newKey = () => randomBytes(18).toString('base64url');
const hash = (key: string) => createHash('sha256').update(key).digest();

export function openDatabase(filename = ':memory:'): Database.Database {
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

export class TreeStore {
  constructor(private db: Database.Database) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS trees (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        edit_key_hash BLOB NOT NULL,
        view_key TEXT NOT NULL,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS persons (
        tree_id TEXT NOT NULL REFERENCES trees(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (tree_id, id)
      );
      CREATE TABLE IF NOT EXISTS unions (
        tree_id TEXT NOT NULL REFERENCES trees(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (tree_id, id)
      );
      CREATE TABLE IF NOT EXISTS changes (
        tree_id TEXT NOT NULL REFERENCES trees(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (tree_id, version)
      );
    `);
    // Added with user accounts; older databases get the column on start-up.
    const columns = this.db.prepare('PRAGMA table_info(trees)').all() as { name: string }[];
    if (!columns.some((c) => c.name === 'owner_id')) this.db.exec('ALTER TABLE trees ADD COLUMN owner_id TEXT');
    this.db.exec('CREATE INDEX IF NOT EXISTS trees_owner ON trees(owner_id)');
  }

  /** Returns the caller's role for a tree, or null if neither the user nor the key grants anything. */
  authorize(treeId: string, key: string | undefined, userId?: string): Role | null {
    const row = this.db.prepare('SELECT edit_key_hash, view_key, owner_id FROM trees WHERE id = ?').get(treeId) as
      | { edit_key_hash: Buffer; view_key: string; owner_id: string | null }
      | undefined;
    if (!row) return null;
    if (userId && row.owner_id === userId) return 'owner';
    if (!key) return null;
    if (timingSafeEqual(hash(key), row.edit_key_hash)) return 'editor';
    if (timingSafeEqual(hash(key), hash(row.view_key))) return 'viewer';
    return null;
  }

  exists(treeId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM trees WHERE id = ?').get(treeId);
  }

  create(
    name: string,
    tree: FamilyTree,
    ownerId: string | null = null,
  ): { id: string; editKey: string; viewKey: string; version: number } {
    const id = randomBytes(9).toString('base64url');
    const editKey = newKey();
    const viewKey = newKey();
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO trees (id, name, edit_key_hash, view_key, version, created_at, updated_at, owner_id)
           VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
        )
        .run(id, name, hash(editKey), viewKey, now, now, ownerId);
      const p = this.db.prepare('INSERT INTO persons VALUES (?, ?, ?)');
      for (const person of Object.values(tree.persons)) p.run(id, person.id, JSON.stringify(person));
      const u = this.db.prepare('INSERT INTO unions VALUES (?, ?, ?)');
      for (const union of Object.values(tree.unions)) u.run(id, union.id, JSON.stringify(union));
    })();
    return { id, editKey, viewKey, version: 1 };
  }

  meta(treeId: string): TreeMeta {
    const row = this.db.prepare('SELECT id, name, version, updated_at FROM trees WHERE id = ?').get(treeId) as {
      id: string;
      name: string;
      version: number;
      updated_at: string;
    };
    return { id: row.id, name: row.name, version: row.version, updatedAt: row.updated_at };
  }

  listByOwner(ownerId: string): TreeMeta[] {
    const rows = this.db
      .prepare('SELECT id, name, version, updated_at FROM trees WHERE owner_id = ? ORDER BY updated_at DESC')
      .all(ownerId) as { id: string; name: string; version: number; updated_at: string }[];
    return rows.map((r) => ({ id: r.id, name: r.name, version: r.version, updatedAt: r.updated_at }));
  }

  /** Replaces a key, so links carrying the old one stop working. */
  rotateKey(treeId: string, which: 'edit' | 'view'): string {
    const key = newKey();
    if (which === 'edit') this.db.prepare('UPDATE trees SET edit_key_hash = ? WHERE id = ?').run(hash(key), treeId);
    else this.db.prepare('UPDATE trees SET view_key = ? WHERE id = ?').run(key, treeId);
    return key;
  }

  rename(treeId: string, name: string) {
    this.db.prepare('UPDATE trees SET name = ? WHERE id = ?').run(name, treeId);
  }

  viewKey(treeId: string): string {
    return (this.db.prepare('SELECT view_key FROM trees WHERE id = ?').get(treeId) as { view_key: string }).view_key;
  }

  load(treeId: string): { meta: TreeMeta; tree: FamilyTree } {
    return this.db.transaction(() => {
      const tree: FamilyTree = { version: 1, persons: {}, unions: {} };
      const persons = this.db.prepare('SELECT data FROM persons WHERE tree_id = ?').all(treeId) as { data: string }[];
      for (const { data } of persons) {
        const p = JSON.parse(data);
        tree.persons[p.id] = p;
      }
      const unions = this.db.prepare('SELECT data FROM unions WHERE tree_id = ?').all(treeId) as { data: string }[];
      for (const { data } of unions) {
        const u = JSON.parse(data);
        tree.unions[u.id] = u;
      }
      return { meta: this.meta(treeId), tree };
    })();
  }

  changesSince(treeId: string, since: number): { version: number; changes: Change[] } {
    return this.db.transaction(() => {
      const rows = this.db
        .prepare('SELECT data FROM changes WHERE tree_id = ? AND version > ? ORDER BY version')
        .all(treeId, since) as { data: string }[];
      return { version: this.meta(treeId).version, changes: rows.flatMap((r) => JSON.parse(r.data) as Change[]) };
    })();
  }

  /** Applies a change set if the client is up to date; otherwise returns null (conflict). */
  applyChanges(treeId: string, baseVersion: number, changes: Change[]): number | null {
    return this.db.transaction(() => {
      const { version } = this.meta(treeId);
      if (version !== baseVersion) return null;
      const next = version + 1;
      const tables = { person: 'persons', union: 'unions' } as const;
      for (const c of changes) {
        const table = tables[c.kind];
        if (c.value) {
          this.db
            .prepare(
              `INSERT INTO ${table} VALUES (?, ?, ?) ON CONFLICT(tree_id, id) DO UPDATE SET data = excluded.data`,
            )
            .run(treeId, c.id, JSON.stringify(c.value));
        } else {
          this.db.prepare(`DELETE FROM ${table} WHERE tree_id = ? AND id = ?`).run(treeId, c.id);
        }
      }
      this.db.prepare('INSERT INTO changes VALUES (?, ?, ?)').run(treeId, next, JSON.stringify(changes));
      this.db
        .prepare('UPDATE trees SET version = ?, updated_at = ? WHERE id = ?')
        .run(next, new Date().toISOString(), treeId);
      return next;
    })();
  }

  delete(treeId: string) {
    this.db.prepare('DELETE FROM trees WHERE id = ?').run(treeId);
  }
}
