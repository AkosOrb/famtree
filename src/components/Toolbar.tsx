import { useRef } from 'react';
import { generateTree, sampleTree } from '../model/sample';
import { parseTree } from '../model/storage';
import { emptyTree, type FamilyTree, type Id } from '../model/types';
import { PersonPicker } from './PersonPicker';

interface Props {
  tree: FamilyTree;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onAddPerson: () => void;
  onSelect: (id: Id) => void;
  onReplace: (tree: FamilyTree) => void;
  onFit: () => void;
  onError: (message: string) => void;
}

export function Toolbar(props: Props) {
  const { tree, canUndo, canRedo, onUndo, onRedo, onAddPerson, onSelect, onReplace, onFit, onError } = props;
  const fileRef = useRef<HTMLInputElement>(null);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(tree, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'csaladfa.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = async (file: File) => {
    try {
      onReplace(parseTree(await file.text()));
    } catch (e) {
      onError(e instanceof Error ? e.message : 'A fájl nem olvasható.');
    }
  };

  const loadDemo = (value: string) => {
    if (!value) return;
    if (Object.keys(tree.persons).length && !confirm('A jelenlegi családfa lecserélődik. Folytatod?')) return;
    if (value === 'sample') onReplace(sampleTree());
    else if (value === 'empty') onReplace(emptyTree());
    else onReplace(generateTree(Number(value)));
  };

  return (
    <header className="toolbar">
      <h1>Családfa</h1>
      <div className="toolbar-search">
        <PersonPicker tree={tree} onPick={onSelect} placeholder="Személy keresése…" />
      </div>
      <div className="toolbar-actions">
        <button onClick={onAddPerson}>+ Személy</button>
        <button onClick={onUndo} disabled={!canUndo} title="Visszavonás (Ctrl+Z)">
          ↶
        </button>
        <button onClick={onRedo} disabled={!canRedo} title="Újra (Ctrl+Y)">
          ↷
        </button>
        <button onClick={onFit} title="Teljes fa megjelenítése">
          Igazítás
        </button>
        <button onClick={exportJson}>Exportálás</button>
        <button onClick={() => fileRef.current?.click()}>Importálás</button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importJson(file);
            e.target.value = '';
          }}
        />
        <select
          value=""
          onChange={(e) => loadDemo(e.target.value)}
          aria-label="Minta adatok betöltése"
        >
          <option value="">Minta adatok…</option>
          <option value="sample">Kis mintacsalád</option>
          <option value="500">Generált: 500 fő</option>
          <option value="2000">Generált: 2000 fő</option>
          <option value="5000">Generált: 5000 fő</option>
          <option value="empty">Üres fa</option>
        </select>
      </div>
    </header>
  );
}
