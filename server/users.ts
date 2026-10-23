import type Database from 'better-sqlite3';
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export interface User {
  id: string;
  email: string;
  name: string;
}

const SESSION_DAYS = 30;
const tokenHash = (token: string) => createHash('sha256').update(token).digest();

/** Accounts with scrypt-hashed passwords and opaque session tokens (stored only as hashes). */
export class UserStore {
  constructor(private db: Database.Database) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        password_salt BLOB NOT NULL,
        password_hash BLOB NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash BLOB PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL
      );
    `);
  }

  async register(email: string, name: string, password: string): Promise<User | null> {
    const normalized = email.trim().toLowerCase();
    if (this.db.prepare('SELECT 1 FROM users WHERE email = ?').get(normalized)) return null;
    const salt = randomBytes(16);
    const passwordHash = await scryptAsync(password, salt, 32);
    const user: User = { id: randomBytes(9).toString('base64url'), email: normalized, name: name.trim() };
    try {
      this.db
        .prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)')
        .run(user.id, user.email, user.name, salt, passwordHash, new Date().toISOString());
    } catch {
      return null; // Lost a race on the unique email.
    }
    return user;
  }

  async verify(email: string, password: string): Promise<User | null> {
    const row = this.db
      .prepare('SELECT id, email, name, password_salt, password_hash FROM users WHERE email = ?')
      .get(email.trim().toLowerCase()) as
      | { id: string; email: string; name: string; password_salt: Buffer; password_hash: Buffer }
      | undefined;
    // Hash even for unknown emails so timing does not reveal which accounts exist.
    const candidate = await scryptAsync(password, row?.password_salt ?? Buffer.alloc(16), 32);
    if (!row || !timingSafeEqual(candidate, row.password_hash)) return null;
    return { id: row.id, email: row.email, name: row.name };
  }

  createSession(userId: string): { token: string; expires: Date } {
    const token = randomBytes(32).toString('base64url');
    const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
    this.db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(tokenHash(token), userId, expires.toISOString());
    return { token, expires };
  }

  userForSession(token: string | undefined): User | null {
    if (!token) return null;
    const row = this.db
      .prepare(
        `SELECT u.id, u.email, u.name, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ?`,
      )
      .get(tokenHash(token)) as (User & { expires_at: string }) | undefined;
    if (!row || new Date(row.expires_at) < new Date()) return null;
    return { id: row.id, email: row.email, name: row.name };
  }

  deleteSession(token: string) {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
  }
}
