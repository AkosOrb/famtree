import { useRef } from 'react';
import type { ViewDepth } from '../App';
import { exportGedcom, importGedcom } from '../model/gedcom';
import type { User } from '../sync/api';
import type { SyncStatus } from '../sync/useServerSync';
import { generateTree, sampleTree } from '../model/sample';
import { parseTree } from '../model/storage';
import { emptyTree, type FamilyTree, type Id } from '../model/types';
import { PersonPicker } from './PersonPicker';
import { askConfirm } from './ConfirmDialog';

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
  viewDepth: ViewDepth;
  onViewDepth: (depth: ViewDepth) => void;
  readOnly: boolean;
  treeName?: string;
  syncStatus: SyncStatus | 'local' | 'loading' | 'readonly';
  /** Undefined when no server is available. */
  onShare?: () => void;
  user?: User | null;
  onAccount?: () => void;
}

const STATUS_LABEL: Record<Props['syncStatus'], string> = {
  local: 'Csak ebben a böngészőben',
  loading: 'Betöltés…',
  saved: 'Mentve a szerveren',
  saving: 'Mentés…',
  offline: 'Nincs kapcsolat, újrapróbálom…',
  error: 'Mentési hiba',
  readonly: 'Csak olvasható',
};

function download(content: string, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function Toolbar(props: Props) {
  const { tree, canUndo, canRedo, onUndo, onRedo, onAddPerson, onSelect, onReplace, onFit, onError } = props;
  const { viewDepth, onViewDepth, readOnly, treeName, syncStatus, onShare, user, onAccount } = props;
  const fileRef = useRef<HTMLInputElement>(null);

  const exportAs = (format: string) => {
    if (format === 'json') download(JSON.stringify(tree, null, 2), 'application/json', 'csaladfa.json');
    else if (format === 'ged') download(exportGedcom(tree), 'text/plain', 'csaladfa.ged');
  };

  const importJson = async (file: File) => {
    try {
      const text = await file.text();
      onReplace(/\.ged(com)?$/i.test(file.name) ? importGedcom(text) : parseTree(text));
    } catch (e) {
      onError(e instanceof Error ? e.message : 'A fájl nem olvasható.');
    }
  };

  const loadDemo = async (value: string) => {
    if (!value) return;
    if (
      Object.keys(tree.persons).length &&
      !(await askConfirm('A jelenlegi családfa lecserélődik. Folytatod?', 'Csere'))
    )
      return;
    if (value === 'sample') onReplace(sampleTree());
    else if (value === 'empty') onReplace(emptyTree());
    else onReplace(generateTree(Number(value)));
  };

  return (
    <header className="toolbar">
      <div className="title">
        <h1>{treeName ?? 'Családfa'}</h1>
        <span className={`sync sync-${syncStatus}`}>{STATUS_LABEL[syncStatus]}</span>
      </div>
      <div className="toolbar-search">
        <PersonPicker tree={tree} onPick={onSelect} placeholder="Személy keresése…" />
      </div>
      <div className="toolbar-actions">
        {!readOnly && (
          <>
            <button onClick={onAddPerson}>+ Személy</button>
            <button onClick={onUndo} disabled={!canUndo} title="Visszavonás (Ctrl+Z)">
              ↶
            </button>
            <button onClick={onRedo} disabled={!canRedo} title="Újra (Ctrl+Y)">
              ↷
            </button>
          </>
        )}
        <button onClick={onFit} title="Teljes fa megjelenítése">
          Igazítás
        </button>
        <select value={viewDepth} onChange={(e) => onViewDepth(Number(e.target.value) as ViewDepth)} aria-label="Nézet">
          <option value={0}>Teljes fa</option>
          <option value={2}>Kijelölt körül: ±2 generáció</option>
          <option value={3}>Kijelölt körül: ±3 generáció</option>
          <option value={5}>Kijelölt körül: ±5 generáció</option>
        </select>
        <select value="" onChange={(e) => exportAs(e.target.value)} aria-label="Exportálás">
          <option value="">Exportálás…</option>
          <option value="json">JSON</option>
          <option value="ged">GEDCOM (.ged)</option>
        </select>
        {!readOnly && (
          <>
            <button onClick={() => fileRef.current?.click()}>Importálás</button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json,.ged,.gedcom"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void importJson(file);
                e.target.value = '';
              }}
            />
            <select value="" onChange={(e) => void loadDemo(e.target.value)} aria-label="Minta adatok betöltése">
              <option value="">Minta adatok…</option>
              <option value="sample">Kis mintacsalád</option>
              <option value="500">Generált: 500 fő</option>
              <option value="2000">Generált: 2000 fő</option>
              <option value="5000">Generált: 5000 fő</option>
              <option value="empty">Üres fa</option>
            </select>
          </>
        )}
        {onShare && syncStatus !== 'readonly' && syncStatus !== 'loading' && (
          <button className="primary" onClick={onShare}>
            Megosztás
          </button>
        )}
        {onAccount && <button onClick={onAccount}>{user ? user.name : 'Bejelentkezés'}</button>}
      </div>
    </header>
  );
}
