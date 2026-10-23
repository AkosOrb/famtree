import type { FamilyTree } from '../model/types';
import type { Change } from './changes';

export type Role = 'editor' | 'viewer';

/** Which server tree this tab works on; the key lives in the URL fragment. */
export interface ServerSession {
  treeId: string;
  key: string;
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
  load: (s: ServerSession) =>
    call<{ name: string; version: number; role: Role; tree: FamilyTree }>(`/api/trees/${s.treeId}`, { key: s.key }),
  changesSince: (s: ServerSession, since: number) =>
    call<{ version: number; changes: Change[] }>(`/api/trees/${s.treeId}/changes?since=${since}`, { key: s.key }),
  push: (s: ServerSession, baseVersion: number, changes: Change[]) =>
    call<{ version: number }>(`/api/trees/${s.treeId}/changes`, {
      method: 'POST',
      key: s.key,
      body: JSON.stringify({ baseVersion, changes }),
    }),
  viewKey: (s: ServerSession) => call<{ viewKey: string }>(`/api/trees/${s.treeId}/share`, { key: s.key }),
};

export function sessionFromUrl(): ServerSession | null {
  const treeId = new URLSearchParams(location.search).get('tree');
  const key = new URLSearchParams(location.hash.slice(1)).get('key');
  return treeId && key ? { treeId, key } : null;
}

export function shareUrl(treeId: string, key: string): string {
  return `${location.origin}${location.pathname}?tree=${encodeURIComponent(treeId)}#key=${encodeURIComponent(key)}`;
}
