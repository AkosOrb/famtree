import { useMemo, useState, type FormEvent } from 'react';
import { addStory, removeStory, updateStory } from '../model/operations';
import type { LineageMode } from '../model/subtree';
import { fullName, sortedStories, storiesOf, type FamilyTree, type Id, type Story, type StoryInput } from '../model/types';
import { askConfirm } from './ConfirmDialog';
import type { EditFn } from './PersonPanel';
import { PersonPicker } from './PersonPicker';

interface Props {
  tree: FamilyTree;
  edit: EditFn;
  readOnly: boolean;
  selectedId: Id | null;
  /** The card whose members are highlighted on the tree. */
  activeStory: Id | null;
  onShowStory: (id: Id | null) => void;
  onSelect: (id: Id) => void;
  onFocusOn: (id: Id, mode: LineageMode) => void;
  onClose: () => void;
}

/** Family history cards: stories, events and memories with the family members they are about. */
export function StoriesPanel(props: Props) {
  const { tree, edit, readOnly, selectedId, activeStory, onShowStory, onSelect, onFocusOn, onClose } = props;
  /** null: list; 'new': new card; otherwise the id of the card being edited. */
  const [editing, setEditing] = useState<Id | 'new' | null>(null);
  const [onlySelected, setOnlySelected] = useState(false);
  const filterId = onlySelected && selectedId && tree.persons[selectedId] ? selectedId : null;
  const stories = useMemo(() => {
    const all = Object.values(storiesOf(tree));
    return sortedStories(filterId ? all.filter((s) => s.members.includes(filterId)) : all);
  }, [tree, filterId]);

  const editingStory = editing && editing !== 'new' ? storiesOf(tree)[editing] : undefined;

  return (
    <aside className="panel stories-panel" aria-label="Családtörténetek">
      <header className="panel-header">
        <h2>Családtörténetek</h2>
        <button className="icon" onClick={onClose} aria-label="Bezárás">
          ×
        </button>
      </header>

      {editing ? (
        <StoryEditor
          key={editing}
          tree={tree}
          story={editingStory}
          initialMembers={editing === 'new' && selectedId && tree.persons[selectedId] ? [selectedId] : []}
          onSave={(input) => {
            if (editingStory) {
              const t = edit(
                (t) => updateStory(t, editingStory.id, input),
                (t) => t,
              );
              if (t) setEditing(null);
            } else {
              const r = edit(
                (t) => addStory(t, input),
                ([t]) => t,
              );
              if (r) {
                setEditing(null);
                onShowStory(r[1]);
              }
            }
          }}
          onDelete={
            editingStory
              ? async () => {
                  if (!(await askConfirm(`Törlöd ezt a történetet: „${editingStory.title}”?`, 'Törlés'))) return;
                  edit(
                    (t) => removeStory(t, editingStory.id),
                    (t) => t,
                  );
                  if (activeStory === editingStory.id) onShowStory(null);
                  setEditing(null);
                }
              : undefined
          }
          onCancel={() => setEditing(null)}
        />
      ) : (
        <>
          <p className="muted">
            Írd le a család eseményeit, emlékeit, és rendeld hozzájuk az érintett családtagokat. Egy kártyára
            kattintva a tagjai kiemelődnek a fán.
          </p>
          {!readOnly && (
            <button className="primary" onClick={() => setEditing('new')}>
              + Új történet
            </button>
          )}
          {selectedId && tree.persons[selectedId] && (
            <label className="checkbox">
              <input type="checkbox" checked={onlySelected} onChange={(e) => setOnlySelected(e.target.checked)} />
              <span>Csak {fullName(tree.persons[selectedId])} történetei</span>
            </label>
          )}
          {stories.length === 0 && (
            <p className="muted">{filterId ? 'Ehhez a személyhez még nincs történet.' : 'Még nincs történet.'}</p>
          )}
          <ul className="story-list">
            {stories.map((s) => (
              <li key={s.id}>
                <StoryCard
                  tree={tree}
                  story={s}
                  active={s.id === activeStory}
                  readOnly={readOnly}
                  onToggle={() => onShowStory(s.id === activeStory ? null : s.id)}
                  onEdit={() => setEditing(s.id)}
                  onSelect={onSelect}
                  onFocusOn={onFocusOn}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}

function StoryCard({
  tree,
  story,
  active,
  readOnly,
  onToggle,
  onEdit,
  onSelect,
  onFocusOn,
}: {
  tree: FamilyTree;
  story: Story;
  active: boolean;
  readOnly: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onSelect: (id: Id) => void;
  onFocusOn: (id: Id, mode: LineageMode) => void;
}) {
  const members = story.members.filter((m) => tree.persons[m]);
  const meta = [story.date, story.place].filter(Boolean).join(' · ');
  return (
    <article className={`story-card${active ? ' active' : ''}`}>
      <button className="story-head" onClick={onToggle} aria-expanded={active}>
        <strong>{story.title}</strong>
        {meta && <small>{meta}</small>}
        {story.private && <small className="muted">Rejtett a csak olvasható linken</small>}
      </button>
      {story.text && <p className={`story-text${active ? '' : ' clamped'}`}>{story.text}</p>}
      {members.length > 0 && (
        <div className="chips">
          {members.map((id) => (
            <button key={id} className={`chip gender-${tree.persons[id].gender}`} onClick={() => onSelect(id)}>
              {fullName(tree.persons[id])}
            </button>
          ))}
        </div>
      )}
      {active && members.length > 0 && (
        <div className="story-lineage">
          <small className="muted">Családfa egy tagból kiindulva:</small>
          {members.map((id) => (
            <div key={id} className="story-lineage-row">
              <span>{fullName(tree.persons[id])}</span>
              <button onClick={() => onFocusOn(id, 'ancestors')}>Felmenők</button>
              <button onClick={() => onFocusOn(id, 'descendants')}>Utódok</button>
            </div>
          ))}
        </div>
      )}
      <div className="button-row">
        <button onClick={onToggle}>{active ? 'Kiemelés ki' : 'Kiemelés a fán'}</button>
        {!readOnly && <button onClick={onEdit}>Szerkesztés</button>}
      </div>
    </article>
  );
}

function StoryEditor({
  tree,
  story,
  initialMembers,
  onSave,
  onDelete,
  onCancel,
}: {
  tree: FamilyTree;
  story?: Story;
  initialMembers: Id[];
  onSave: (input: StoryInput) => void;
  onDelete?: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => ({
    title: story?.title ?? '',
    date: story?.date ?? '',
    place: story?.place ?? '',
    text: story?.text ?? '',
    private: !!story?.private,
  }));
  const [members, setMembers] = useState<Id[]>(() =>
    (story?.members ?? initialMembers).filter((m) => tree.persons[m]),
  );
  const exclude = useMemo(() => new Set(members), [members]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSave({
      title: draft.title,
      date: draft.date || undefined,
      place: draft.place || undefined,
      text: draft.text,
      members,
      private: draft.private || undefined,
    });
  };

  return (
    <form className="person-form story-form" onSubmit={submit}>
      <label>
        Cím
        <input
          value={draft.title}
          maxLength={200}
          autoFocus
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        />
      </label>
      <div className="row">
        <label>
          Időpont
          <input
            value={draft.date}
            maxLength={100}
            placeholder="pl. 1956 ősze"
            onChange={(e) => setDraft({ ...draft, date: e.target.value })}
          />
        </label>
        <label>
          Helyszín
          <input value={draft.place} maxLength={200} onChange={(e) => setDraft({ ...draft, place: e.target.value })} />
        </label>
      </div>
      <label>
        Történet
        <textarea
          rows={6}
          value={draft.text}
          maxLength={20000}
          onChange={(e) => setDraft({ ...draft, text: e.target.value })}
        />
      </label>
      <div className="relative-list">
        <h3>Családtagok</h3>
        {members.length > 0 && (
          <ul className="relative-rows">
            {members.map((id) => (
              <li key={id}>
                <span className={`chip gender-${tree.persons[id].gender}`}>{fullName(tree.persons[id])}</span>
                <button
                  type="button"
                  className="icon remove-relation"
                  onClick={() => setMembers(members.filter((m) => m !== id))}
                  aria-label={`Eltávolítás: ${fullName(tree.persons[id])}`}
                  title="Eltávolítás a történetből"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <PersonPicker
          tree={tree}
          exclude={exclude}
          onPick={(id) => setMembers([...members, id])}
          placeholder="Családtag hozzáadása…"
        />
      </div>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={draft.private}
          onChange={(e) => setDraft({ ...draft, private: e.target.checked })}
        />
        <span>
          Rejtett a csak olvasható linken
          <small>
            A csak olvasható linken akkor sem látszik, ha valamelyik tagja rejtett, vagy a megjegyzések rejtve vannak.
          </small>
        </span>
      </label>
      <div className="button-row">
        <button type="submit" className="primary" disabled={!draft.title.trim()}>
          Mentés
        </button>
        <button type="button" onClick={onCancel}>
          Mégse
        </button>
      </div>
      {onDelete && (
        <button type="button" className="danger" onClick={onDelete}>
          Történet törlése
        </button>
      )}
    </form>
  );
}
