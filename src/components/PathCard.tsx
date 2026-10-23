import { kinshipTerm, relationWord, type PathStep } from '../model/relationship';
import { fullName, type FamilyTree, type Id } from '../model/types';

interface Props {
  tree: FamilyTree;
  from: Id;
  to: Id;
  path: PathStep[] | null;
  onSelect: (id: Id) => void;
  onClose: () => void;
}

/** Explains the relationship between two people, step by step. */
export function PathCard({ tree, from, to, path, onSelect, onClose }: Props) {
  const a = fullName(tree.persons[from]);
  const b = fullName(tree.persons[to]);
  const term = path ? kinshipTerm(tree, path) : null;
  return (
    <section className="path-card" aria-label="Rokoni kapcsolat">
      <header className="panel-header">
        <h2>Kapcsolat</h2>
        <button className="icon" onClick={onClose} aria-label="Kiemelés bezárása">
          ×
        </button>
      </header>
      {!path ? (
        <p className="term">
          {a} és {b} között nincs rögzített rokoni kapcsolat.
        </p>
      ) : (
        <>
          <p className="term">
            {term ? (
              <>
                {b} {a} <strong>{term}</strong>.
              </>
            ) : (
              <>
                {a} és {b} között {path.length - 1} lépés a kapcsolat.
              </>
            )}
          </p>
          <ol className="path-steps">
            {path.map((step) => (
              <li key={step.id}>
                <span className="rel">
                  {step.relation ? relationWord(step.relation, tree.persons[step.id].gender) : 'kiindulás'}
                </span>
                <button onClick={() => onSelect(step.id)}>{fullName(tree.persons[step.id])}</button>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
