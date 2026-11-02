import { useEffect, useRef, useState } from 'react';

interface Props {
  families: { name: string; count: number }[];
  selected: string[];
  onChange: (names: string[]) => void;
}

/** Folds case and accents, so "kovacs" finds "Kovács". */
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('hu');

/** Picks one or more families by name, with a search box over the list. */
export function FamilyPicker({ families, selected, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    // Capture phase: the tree canvas handles its own pointer events.
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [open]);

  const q = fold(query.trim());
  const shown = q ? families.filter((f) => fold(f.name).includes(q)) : families;
  const toggle = (name: string) =>
    onChange(selected.includes(name) ? selected.filter((n) => n !== name) : [...selected, name]);
  const label = selected.length ? selected.map((n) => `${n}`).join(', ') : 'Válassz családot';

  return (
    <div className="picker family-picker" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        title="A családok tagjai és akik beházasodtak; több család is kijelölhető"
      >
        {selected.length > 1 ? `${selected.length} család: ` : ''}
        {label} ▾
      </button>
      {open && (
        <div className="picker-results family-list">
          <input
            autoFocus
            type="search"
            placeholder="Család keresése…"
            aria-label="Család keresése"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
          />
          <ul role="listbox" aria-multiselectable="true" aria-label="Családok">
            {shown.map((f) => (
              <li key={f.name} role="option" aria-selected={selected.includes(f.name)}>
                <label>
                  <input type="checkbox" checked={selected.includes(f.name)} onChange={() => toggle(f.name)} />
                  <span>{f.name} család</span>
                  <small>{f.count}</small>
                </label>
              </li>
            ))}
            {!shown.length && <li className="family-none">Nincs ilyen nevű család</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
