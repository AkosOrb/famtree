import type { PrivacySettings } from '../model/privacy';
import type { FamilyTree } from '../model/types';
import type { Change } from './changes';

export type Role = 'owner' | 'editor' | 'viewer';

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface TreeSummary {
  id: string;
  name: string;
  version: number;
  updatedAt: string;
}

/**
 * Which server tree this tab works on. The key (if any) lives in the URL
 * fragment; without one, access comes from the signed-in owner's cookie.
 */
export interface ServerSession {
  treeId: string;
  key?: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit & { key?: string } = {}): Promise<T> {
  const { key, ...rest } = init;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;
  const res = await fetch(path, { ...rest, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error ?? `Szerverhiba (${res.status})`, res.status);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const api = {
  create: (name: string, tree: FamilyTree) =>
    call<{ id: string; editKey: string; viewKey: string; version: number }>('/api/trees', {
      method: 'POST',
      body: JSON.stringify({ name, tree }),
    }),
  /** `privacy` and `canSetPrivacy` are present for owners and editors only. */
  load: (s: ServerSession) =>
    call<{
      name: string;
      version: number;
      role: Role;
      tree: FamilyTree;
      privacy?: PrivacySettings;
      canSetPrivacy?: boolean;
    }>(`/api/trees/${s.treeId}`, { key: s.key }),
  setPrivacy: (s: ServerSession, settings: PrivacySettings) =>
    call<PrivacySettings>(`/api/trees/${s.treeId}/privacy`, {
      method: 'PUT',
      key: s.key,
      body: JSON.stringify(settings),
    }),
  changesSince: (s: ServerSession, since: number) =>
    call<{ version: number; changes: Change[] }>(`/api/trees/${s.treeId}/changes?since=${since}`, { key: s.key }),
  push: (s: ServerSession, baseVersion: number, changes: Change[]) =>
    call<{ version: number }>(`/api/trees/${s.treeId}/changes`, {
      method: 'POST',
      key: s.key,
      body: JSON.stringify({ baseVersion, changes }),
    }),
  viewKey: (s: ServerSession) => call<{ viewKey: string }>(`/api/trees/${s.treeId}/share`, { key: s.key }),
  rotateKey: (s: ServerSession, which: 'edit' | 'view') =>
    call<{ key: string }>(`/api/trees/${s.treeId}/keys`, {
      method: 'POST',
      key: s.key,
      body: JSON.stringify({ which }),
    }),
  deleteTree: (treeId: string) => call<void>(`/api/trees/${treeId}`, { method: 'DELETE' }),
  myTrees: () => call<TreeSummary[]>('/api/trees'),
  me: () => call<User | null>('/api/auth/me'),
  login: (email: string, password: string) =>
    call<User>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (email: string, name: string, password: string, acceptPrivacy: boolean) =>
    call<User>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, name, password, acceptPrivacy }),
    }),
  logout: () => call<void>('/api/auth/logout', { method: 'POST' }),
  logoutAll: () => call<void>('/api/account/logout-all', { method: 'POST' }),
  changePassword: (currentPassword: string, newPassword: string) =>
    call<User>('/api/account/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),
  exportAccount: () => call<unknown>('/api/account/export'),
  deleteAccount: (password: string) =>
    call<void>('/api/account', { method: 'DELETE', body: JSON.stringify({ password }) }),
};

export function sessionFromUrl(): ServerSession | null {
  const treeId = new URLSearchParams(location.search).get('tree');
  const key = new URLSearchParams(location.hash.slice(1)).get('key') ?? undefined;
  return treeId ? { treeId, key } : null;
}

export function shareUrl(treeId: string, key?: string): string {
  const base = `${location.origin}${location.pathname}?tree=${encodeURIComponent(treeId)}`;
  return key ? `${base}#key=${encodeURIComponent(key)}` : base;
}
