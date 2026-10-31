import type { Layout } from './layout';
import type { Relation } from '../model/relationship';
import type { Id } from '../model/types';

export interface Link {
  /** The related person. */
  id: Id;
  /** What `id` is to the person the links are for. */
  relation: Relation;
}

/** A person's direct relatives that are visible in the layout: parents, partners and children. */
export function directLinks(layout: Layout, id: Id): Link[] {
  const links: Link[] = [];
  const seen = new Set<string>();
  const add = (other: Id, relation: Relation) => {
    const key = `${relation}:${other}`;
    if (other === id || seen.has(key) || !layout.persons.has(other)) return;
    seen.add(key);
    links.push({ id: other, relation });
  };
  for (const u of layout.unions) {
    if (u.partners.includes(id)) {
      for (const p of u.partners) add(p, 'partner');
      for (const c of u.children) add(c, 'child');
    }
    if (u.children.includes(id)) for (const p of u.partners) add(p, 'parent');
  }
  return links;
}
