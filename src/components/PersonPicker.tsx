import { useMemo, useState } from 'react';
import { fullName, type FamilyTree, type Id } from '../model/types';

const MAX_RESULTS = 20;

/** Search-as-you-type person selector; shows only a handful of matches so it scales to large trees. */
export function searchPersons(tree: FamilyTree, query: string, exclude: Set<Id> = new Set()) {
  const q = query.trim().toLocaleLowerCase('hu');
  const results = [];
  for (const p of Object.values(tree.persons)) {
    if (exclude.has(p.id)) continue;
    const name = fullName(p).toLocaleLowerCase('hu');
    if (!q || name.includes(q) || String(p.birthYear ?? '').startsWith(q)) {
      results.push(p);
      if (results.length >= MAX_RESULTS) break;
    }
  }
  return results;
}

export function PersonPicker({
  tree,
  exclude,
  onPick,
  placeholder = 'Keresés név alapján…',
  autoFocus,
}: {
  tree: FamilyTree;
  exclude?: Set<Id>;
  onPick: (id: Id) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const results = useMemo(() => (open ? searchPersons(tree, query, exclude) : []), [tree, query, exclude, open]);
  return (
    <div className="picker">
      <input
        type="search"
        value={query}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && results[0]) {
            onPick(results[0].id);
            setQuery('');
            setOpen(false);
          }
        }}
      />
      {open && results.length > 0 && (
        <ul className="picker-results">
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick(p.id);
                  setQuery('');
                  setOpen(false);
                }}
              >
                <span>{fullName(p)}</span>
                {p.birthYear != null && <small>{p.birthYear}</small>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
