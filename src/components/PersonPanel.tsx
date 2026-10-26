import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { childrenOf, parentsOf, partnersOf, siblingsOf, type TreeIndex } from '../model/graph';
import {
  addChild,
  addParent,
  addPartner,
  linkChild,
  linkParent,
  linkPartners,
  removePerson,
  setOtherParent,
  unlinkParent,
  unlinkPartners,
  updatePerson,
} from '../model/operations';
import { fullName, type FamilyTree, type Gender, type Id, type PersonInput } from '../model/types';
import { photoFromFile } from '../model/photo';
import { PersonPicker } from './PersonPicker';
import { askConfirm } from './ConfirmDialog';

export type EditFn = <T>(fn: (t: FamilyTree) => T, pick: (r: T) => FamilyTree) => T | undefined;

type Relation = 'parent' | 'partner' | 'child';

const GENDERS: { value: Gender; label: string }[] = [
  { value: 'female', label: 'Nő' },
  { value: 'male', label: 'Férfi' },
  { value: 'other', label: 'Egyéb' },
  { value: 'unknown', label: 'Nem ismert' },
];

const RELATION_LABEL: Record<Relation, string> = { parent: 'Szülő', partner: 'Pár', child: 'Gyermek' };

const parseYear = (v: string) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
};

interface Props {
  tree: FamilyTree;
  index: TreeIndex;
  personId: Id;
  edit: EditFn;
  onSelect: (id: Id) => void;
  onFocusOn: (id: Id) => void;
  onFindPath: (other: Id) => void;
  onClose: () => void;
  readOnly?: boolean;
}

export function PersonPanel({
  tree,
  index,
  personId,
  edit,
  onSelect,
  onFocusOn,
  onFindPath,
  onClose,
  readOnly,
}: Props) {
  const [findingPath, setFindingPath] = useState(false);
  const person = tree.persons[personId];
  const [draft, setDraft] = useState(() => ({
    firstName: person.firstName,
    lastName: person.lastName,
    gender: person.gender,
    birthYear: person.birthYear?.toString() ?? '',
    deathYear: person.deathYear?.toString() ?? '',
    notes: person.notes ?? '',
  }));
  const [adding, setAdding] = useState<Relation | null>(null);

  const relatives = useMemo(
    () => ({
      parents: parentsOf(tree, index, personId),
      partners: partnersOf(tree, index, personId),
      children: childrenOf(tree, index, personId),
      siblings: siblingsOf(tree, index, personId),
    }),
    [tree, index, personId],
  );

  const dirty =
    draft.firstName !== person.firstName ||
    draft.lastName !== person.lastName ||
    draft.gender !== person.gender ||
    parseYear(draft.birthYear) !== person.birthYear ||
    parseYear(draft.deathYear) !== person.deathYear ||
    draft.notes !== (person.notes ?? '');

  const save = (e: FormEvent) => {
    e.preventDefault();
    edit(
      (t) =>
        updatePerson(t, personId, {
          firstName: draft.firstName.trim(),
          lastName: draft.lastName.trim(),
          gender: draft.gender,
          birthYear: parseYear(draft.birthYear),
          deathYear: parseYear(draft.deathYear),
          notes: draft.notes.trim() || undefined,
        }),
      (t) => t,
    );
  };

  const otherParentOf = (child: Id) => parentsOf(tree, index, child).find((p) => p !== personId) ?? '';

  const removeRelation = async (relation: Relation, other: Id) => {
    const names = `${fullName(person)} és ${fullName(tree.persons[other])}`;
    const what = relation === 'partner' ? 'párkapcsolatát' : 'szülő–gyermek kapcsolatát';
    if (!(await askConfirm(`Eltávolítod ${names} ${what}? A személyek megmaradnak.`, 'Eltávolítás'))) return;
    edit(
      (t) => {
        if (relation === 'parent') return unlinkParent(t, personId, other);
        if (relation === 'child') return unlinkParent(t, other, personId);
        return unlinkPartners(t, personId, other);
      },
      (t) => t,
    );
  };

  const remove = async () => {
    if (!(await askConfirm(`Biztosan törlöd: ${fullName(person)}? A kapcsolatai is törlődnek.`, 'Törlés'))) return;
    edit(
      (t) => removePerson(t, personId),
      (t) => t,
    );
    onClose();
  };

  return (
    <aside className="panel" aria-label="Személy adatai">
      <header className="panel-header">
        <h2>{fullName(person)}</h2>
        <button className="icon" onClick={onClose} aria-label="Bezárás">
          ×
        </button>
      </header>

      <PhotoField
        photo={person.photo}
        initials={(person.lastName[0] ?? '') + (person.firstName[0] ?? '')}
        gender={person.gender}
        readOnly={readOnly}
        onChange={(photo) =>
          edit(
            (t) => updatePerson(t, personId, { photo }),
            (t) => t,
          )
        }
      />

      {person.redacted ? (
        <p className="muted">Ennek a személynek az adatai adatvédelmi okból rejtettek.</p>
      ) : (
        <form className="person-form" onSubmit={save}>
          <fieldset disabled={readOnly}>
            <div className="row">
              <label>
                Vezetéknév
                <input value={draft.lastName} onChange={(e) => setDraft({ ...draft, lastName: e.target.value })} />
              </label>
              <label>
                Keresztnév
                <input value={draft.firstName} onChange={(e) => setDraft({ ...draft, firstName: e.target.value })} />
              </label>
            </div>
            <div className="row">
              <label>
                Nem
                <select value={draft.gender} onChange={(e) => setDraft({ ...draft, gender: e.target.value as Gender })}>
                  {GENDERS.map((g) => (
                    <option key={g.value} value={g.value}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Született
                <input
                  inputMode="numeric"
                  value={draft.birthYear}
                  onChange={(e) => setDraft({ ...draft, birthYear: e.target.value })}
                />
              </label>
              <label>
                Elhunyt
                <input
                  inputMode="numeric"
                  value={draft.deathYear}
                  onChange={(e) => setDraft({ ...draft, deathYear: e.target.value })}
                />
              </label>
            </div>
            <label>
              Megjegyzés
              <textarea rows={2} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
            </label>
            {!readOnly && (
              <button type="submit" className="primary" disabled={!dirty}>
                Mentés
              </button>
            )}
          </fieldset>
          {!readOnly && (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={!!person.private}
                onChange={(e) =>
                  edit(
                    (t) => updatePerson(t, personId, { private: e.target.checked || undefined }),
                    (t) => t,
                  )
                }
              />
              <span>
                Rejtett a csak olvasható linken
                <small>A link birtokosai csak annyit látnak, hogy itt egy „Rejtett személy” van.</small>
              </span>
            </label>
          )}
        </form>
      )}

      <section className="relatives">
        <RelativeList
          title="Szülők"
          ids={relatives.parents}
          tree={tree}
          onSelect={onSelect}
          onRemove={readOnly ? undefined : (id) => void removeRelation('parent', id)}
        />
        <RelativeList
          title="Párok"
          ids={relatives.partners}
          tree={tree}
          onSelect={onSelect}
          onRemove={readOnly ? undefined : (id) => void removeRelation('partner', id)}
        />
        <RelativeList
          title="Gyermekek"
          ids={relatives.children}
          tree={tree}
          onSelect={onSelect}
          onRemove={readOnly ? undefined : (id) => void removeRelation('child', id)}
          extra={
            readOnly || !relatives.partners.length
              ? undefined
              : (child) => (
                  <select
                    aria-label={`${fullName(tree.persons[child])} másik szülője`}
                    title="Másik szülő"
                    value={otherParentOf(child)}
                    onChange={(e) =>
                      edit(
                        (t) => setOtherParent(t, personId, child, e.target.value || undefined),
                        (t) => t,
                      )
                    }
                  >
                    <option value="">Másik szülő: nincs</option>
                    {relatives.partners.map((p) => (
                      <option key={p} value={p}>
                        Másik szülő: {fullName(tree.persons[p])}
                      </option>
                    ))}
                  </select>
                )
          }
        />
        <RelativeList title="Testvérek" ids={relatives.siblings} tree={tree} onSelect={onSelect} />
      </section>

      {!readOnly && (
        <section className="add-relative">
          <div className="button-row">
            {(['parent', 'partner', 'child'] as Relation[]).map((r) => (
              <button
                key={r}
                className={adding === r ? 'active' : ''}
                disabled={r === 'parent' && relatives.parents.length >= 2}
                onClick={() => setAdding(adding === r ? null : r)}
              >
                + {RELATION_LABEL[r]}
              </button>
            ))}
          </div>
          {adding && (
            <AddRelativeForm
              key={adding}
              relation={adding}
              tree={tree}
              personId={personId}
              partners={relatives.partners}
              exclude={new Set([personId, ...relatives.parents, ...relatives.partners, ...relatives.children])}
              edit={edit}
              onDone={(id) => {
                setAdding(null);
                if (id) onSelect(id);
              }}
            />
          )}
        </section>
      )}

      <button onClick={() => onFocusOn(personId)}>Nézet erre a személyre szűkítve</button>

      {findingPath ? (
        <div className="add-form">
          <p className="muted">Kivel való rokoni kapcsolatát mutassam?</p>
          <PersonPicker
            tree={tree}
            exclude={new Set([personId])}
            onPick={(id) => {
              setFindingPath(false);
              onFindPath(id);
            }}
            autoFocus
          />
          <button onClick={() => setFindingPath(false)}>Mégse</button>
        </div>
      ) : (
        <button onClick={() => setFindingPath(true)}>Kapcsolat keresése másik személlyel</button>
      )}

      {!readOnly && (
        <button className="danger" onClick={remove}>
          Személy törlése
        </button>
      )}
    </aside>
  );
}

function RelativeList({
  title,
  ids,
  tree,
  onSelect,
  onRemove,
  extra,
}: {
  title: string;
  ids: Id[];
  tree: FamilyTree;
  onSelect: (id: Id) => void;
  /** Shown as a remove button next to each relative when the tree is editable. */
  onRemove?: (id: Id) => void;
  extra?: (id: Id) => ReactNode;
}) {
  if (!ids.length) return null;
  const chip = (id: Id) => (
    <button key={id} className={`chip gender-${tree.persons[id].gender}`} onClick={() => onSelect(id)}>
      {fullName(tree.persons[id])}
    </button>
  );
  return (
    <div className="relative-list">
      <h3>{title}</h3>
      {onRemove ? (
        <ul className="relative-rows">
          {ids.map((id) => (
            <li key={id}>
              {chip(id)}
              {extra?.(id)}
              <button
                className="icon remove-relation"
                onClick={() => onRemove(id)}
                aria-label={`Kapcsolat eltávolítása: ${fullName(tree.persons[id])}`}
                title="Kapcsolat eltávolítása"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="chips">{ids.map(chip)}</div>
      )}
    </div>
  );
}

function AddRelativeForm({
  relation,
  tree,
  personId,
  partners,
  exclude,
  edit,
  onDone,
}: {
  relation: Relation;
  tree: FamilyTree;
  personId: Id;
  partners: Id[];
  exclude: Set<Id>;
  edit: EditFn;
  onDone: (id?: Id) => void;
}) {
  const person = tree.persons[personId];
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [coParent, setCoParent] = useState<Id | ''>(partners.length === 1 ? partners[0] : '');
  const [form, setForm] = useState({
    lastName: relation === 'child' ? person.lastName : '',
    firstName: '',
    gender: (relation === 'partner'
      ? person.gender === 'male'
        ? 'female'
        : person.gender === 'female'
          ? 'male'
          : 'unknown'
      : 'unknown') as Gender,
    birthYear: '',
  });

  const createNew = (e: FormEvent) => {
    e.preventDefault();
    const input: PersonInput = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      gender: form.gender,
      birthYear: parseYear(form.birthYear),
    };
    const result = edit(
      (t) => {
        if (relation === 'parent') return addParent(t, personId, input);
        if (relation === 'partner') return addPartner(t, personId, input);
        return addChild(t, personId, input, coParent || undefined);
      },
      ([t]) => t,
    );
    if (result) onDone(result[1]);
  };

  const linkExisting = (other: Id) => {
    const ok = edit(
      (t) => {
        if (relation === 'parent') return linkParent(t, personId, other);
        if (relation === 'partner') return linkPartners(t, personId, other)[0];
        return linkChild(t, personId, other, coParent || undefined);
      },
      (t) => t,
    );
    if (ok) onDone();
  };

  return (
    <div className="add-form">
      <div className="segmented">
        <button className={mode === 'new' ? 'active' : ''} onClick={() => setMode('new')}>
          Új személy
        </button>
        <button className={mode === 'existing' ? 'active' : ''} onClick={() => setMode('existing')}>
          Meglévő személy
        </button>
      </div>

      {relation === 'child' && partners.length > 0 && (
        <label>
          Másik szülő
          <select value={coParent} onChange={(e) => setCoParent(e.target.value)}>
            <option value="">Nincs megadva</option>
            {partners.map((p) => (
              <option key={p} value={p}>
                {fullName(tree.persons[p])}
              </option>
            ))}
          </select>
        </label>
      )}

      {mode === 'new' ? (
        <form onSubmit={createNew}>
          <div className="row">
            <label>
              Vezetéknév
              <input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
            </label>
            <label>
              Keresztnév
              <input
                autoFocus
                value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              />
            </label>
          </div>
          <div className="row">
            <label>
              Nem
              <select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value as Gender })}>
                {GENDERS.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Született
              <input
                inputMode="numeric"
                value={form.birthYear}
                onChange={(e) => setForm({ ...form, birthYear: e.target.value })}
              />
            </label>
          </div>
          <button type="submit" className="primary" disabled={!form.firstName.trim() && !form.lastName.trim()}>
            {RELATION_LABEL[relation]} hozzáadása
          </button>
        </form>
      ) : (
        <PersonPicker tree={tree} exclude={exclude} onPick={linkExisting} autoFocus />
      )}
    </div>
  );
}

function PhotoField({
  photo,
  initials,
  gender,
  readOnly,
  onChange,
}: {
  photo?: string;
  initials: string;
  gender: Gender;
  readOnly?: boolean;
  onChange: (photo: string | undefined) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      onChange(await photoFromFile(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'A képet nem sikerült feltölteni.');
    } finally {
      setBusy(false);
    }
  };

  if (readOnly && !photo) return null;
  return (
    <div className={`photo-row gender-${gender}`}>
      {photo ? (
        <img className="photo" src={photo} alt="Fénykép" />
      ) : (
        <div className="photo" aria-hidden="true">
          {initials.toUpperCase() || '?'}
        </div>
      )}
      {!readOnly && (
        <div className="photo-actions">
          <button type="button" onClick={() => input.current?.click()} disabled={busy}>
            {busy ? 'Feldolgozás…' : photo ? 'Fénykép cseréje' : 'Fénykép feltöltése'}
          </button>
          {photo && (
            <button type="button" className="danger" onClick={() => onChange(undefined)}>
              Fénykép eltávolítása
            </button>
          )}
          {!photo && <small>A kép négyzetesre vágva, kicsinyítve tárolódik.</small>}
          {error && <small className="error">{error}</small>}
          <input
            ref={input}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
              e.target.value = '';
            }}
          />
        </div>
      )}
    </div>
  );
}
