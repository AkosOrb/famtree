import { useMemo, useState, type FormEvent } from 'react';
import { childrenOf, parentsOf, partnersOf, siblingsOf, type TreeIndex } from '../model/graph';
import {
  addChild,
  addParent,
  addPartner,
  linkChild,
  linkParent,
  linkPartners,
  removePerson,
  updatePerson,
} from '../model/operations';
import { fullName, type FamilyTree, type Gender, type Id, type PersonInput } from '../model/types';
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
  onClose: () => void;
  readOnly?: boolean;
}

export function PersonPanel({ tree, index, personId, edit, onSelect, onFocusOn, onClose, readOnly }: Props) {
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
      </form>

      <section className="relatives">
        <RelativeList title="Szülők" ids={relatives.parents} tree={tree} onSelect={onSelect} />
        <RelativeList title="Párok" ids={relatives.partners} tree={tree} onSelect={onSelect} />
        <RelativeList title="Gyermekek" ids={relatives.children} tree={tree} onSelect={onSelect} />
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
}: {
  title: string;
  ids: Id[];
  tree: FamilyTree;
  onSelect: (id: Id) => void;
}) {
  if (!ids.length) return null;
  return (
    <div className="relative-list">
      <h3>{title}</h3>
      <div className="chips">
        {ids.map((id) => (
          <button key={id} className={`chip gender-${tree.persons[id].gender}`} onClick={() => onSelect(id)}>
            {fullName(tree.persons[id])}
          </button>
        ))}
      </div>
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
