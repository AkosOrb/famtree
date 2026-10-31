import { useRef } from 'react';
import type { ViewDepth, ViewMode } from '../App';
import { exportGedcom, importGedcom } from '../model/gedcom';
import type { User } from '../sync/api';
import type { SyncStatus } from '../sync/useServerSync';
import { generateTree, inLawTree } from '../model/sample';
import { parseTree } from '../model/storage';
import { isValidTree, sanitizeTree } from '../sync/changes';
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
  viewMode: ViewMode;
  viewDepth: ViewDepth;
  onView: (mode: ViewMode, depth: ViewDepth) => void;
  is3d: boolean;
  onToggle3d: () => void;
  storiesOpen: boolean;
  onStories: () => void;
  readOnly: boolean;
  treeName?: string;
  syncStatus: SyncStatus | 'local' | 'loading' | 'readonly';
  /** Undefined when no server is available. */
  onShare?: () => void;
  user?: User | null;
  onAccount?: () => void;
  onPrivacy: () => void;
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
  const {
    viewMode,
    viewDepth,
    onView,
    is3d,
    onToggle3d,
    storiesOpen,
    onStories,
    readOnly,
    treeName,
    syncStatus,
    onShare,
    user,
    onAccount,
    onPrivacy,
  } = props;
  const fileRef = useRef<HTMLInputElement>(null);

  const exportAs = (format: string) => {
    if (format === 'json') download(JSON.stringify(tree, null, 2), 'application/json', 'csaladfa.json');
    else if (format === 'ged') download(exportGedcom(tree), 'text/plain', 'csaladfa.ged');
  };

  const importJson = async (file: File) => {
    try {
      const text = await file.text();
      if (/\.ged(com)?$/i.test(file.name)) return onReplace(importGedcom(text));
      // Files can come from anywhere: check every record, and drop fields the app does not know.
      const imported = parseTree(text);
      if (!isValidTree(imported)) throw new Error('A fájl hibás vagy nem családfa adatot tartalmaz.');
      onReplace(sanitizeTree(imported));
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
    if (value === 'sample') onReplace(inLawTree());
    else if (value === 'empty') onReplace(emptyTree());
    else onReplace(generateTree(Number(value), 1, 0.3));
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
        <button onClick={onFit} title={is3d ? 'Vissza a kezdőnézetre: a legbelső kör' : 'Teljes fa megjelenítése'}>
          Igazítás
        </button>
        <select
          value={viewMode}
          onChange={(e) => onView(e.target.value as ViewMode, viewDepth)}
          aria-label="Nézet"
          title="Mit mutasson a fa a kijelölt személyből kiindulva"
        >
          <option value="all">Teljes fa</option>
          <option value="around">Kijelölt körül</option>
          <option value="ancestors">Felmenők</option>
          <option value="descendants">Utódok</option>
          <option value="hourglass">Felmenők és utódok</option>
        </select>
        {viewMode !== 'all' && (
          <select
            value={viewDepth}
            onChange={(e) => onView(viewMode, Number(e.target.value) as ViewDepth)}
            aria-label="Generációk száma"
          >
            <option value={2}>{viewMode === 'around' ? '±' : ''}2 generáció</option>
            <option value={3}>{viewMode === 'around' ? '±' : ''}3 generáció</option>
            <option value={5}>{viewMode === 'around' ? '±' : ''}5 generáció</option>
            <option value={0}>Összes generáció</option>
          </select>
        )}
        <button
          className={is3d ? 'active' : undefined}
          onClick={onToggle3d}
          aria-pressed={is3d}
          title={is3d ? 'Vissza a síkbeli nézetre' : 'Térbeli nézet: a fa egy forgatható henger palástján'}
        >
          3D
        </button>
        <button className={storiesOpen ? 'active' : undefined} onClick={onStories} aria-pressed={storiesOpen}>
          Történetek
        </button>
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
        <button onClick={onPrivacy} title="Adatvédelem" aria-label="Adatvédelem">
          🔒
        </button>
      </div>
    </header>
  );
}
