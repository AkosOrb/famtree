import { select } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { Focus } from '../App';
import { NODE_H, NODE_W, type Layout, type PersonBox, type UnionGeometry } from '../layout/layout';
import { SpatialGrid } from '../layout/spatialGrid';
import type { PathStep } from '../model/relationship';
import { fullName, type FamilyTree, type Id, type Person } from '../model/types';

interface Props {
  tree: FamilyTree;
  layout: Layout;
  /** Persons with relatives hidden by the focus view. */
  truncated: Set<Id>;
  focusRoot: Id | null;
  onFocusOn: (id: Id) => void;
  /** Relationship path to highlight (see model/relationship.ts). */
  path: PathStep[] | null;
  /** Persons to emphasise (e.g. the members of a family history card); others are dimmed. */
  highlight?: Set<Id> | null;
  selectedId: Id | null;
  focus: Focus | null;
  fitNonce: number;
  onSelect: (id: Id | null) => void;
  onAddFirst?: () => void;
}

/** Below this zoom level nodes are drawn without text (level of detail). */
const DETAIL_ZOOM = 0.4;
const CULL_MARGIN = 200;
const MIN_FIT_ZOOM = 0.03;
const AVATAR = 40;

export function TreeCanvas(props: Props) {
  const { tree, layout, truncated, focusRoot, onFocusOn, path, highlight, selectedId, focus, fitNonce, onSelect } =
    props;
  const { onAddFirst } = props;
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const svg = svgRef.current!;
    let frame = 0;
    let latest = zoomIdentity;
    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.002, 2.5])
      .on('zoom', (event) => {
        latest = event.transform;
        // Coalesce zoom events into one React render per animation frame.
        if (!frame) {
          frame = requestAnimationFrame(() => {
            frame = 0;
            setTransform(latest);
          });
        }
      });
    select(svg).call(behavior).on('dblclick.zoom', null);
    zoomRef.current = behavior;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(svg);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      select(svg).on('.zoom', null);
    };
  }, []);

  const animateTo = (target: ZoomTransform) => {
    const svg = svgRef.current;
    const behavior = zoomRef.current;
    if (!svg || !behavior) return;
    const from = transform;
    const start = performance.now();
    const duration = 450;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      const k = from.k + (target.k - from.k) * e;
      const x = from.x + (target.x - from.x) * e;
      const y = from.y + (target.y - from.y) * e;
      behavior.transform(select(svg), zoomIdentity.translate(x, y).scale(k));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  // Fit the whole tree on first render with a real size and whenever requested.
  const fittedFor = useRef(-1);
  useEffect(() => {
    if (!size.width || fittedFor.current === fitNonce) return;
    fittedFor.current = fitNonce;
    const { bounds } = layout;
    const w = bounds.maxX - bounds.minX + NODE_W;
    const h = bounds.maxY - bounds.minY + NODE_H;
    const fitK = Math.min(1, (0.9 * size.width) / w, (0.9 * size.height) / h);
    let target: ZoomTransform;
    if (fitK >= MIN_FIT_ZOOM) {
      target = zoomIdentity
        .translate(
          size.width / 2 - (fitK * (bounds.minX + bounds.maxX)) / 2,
          size.height / 2 - (fitK * (bounds.minY + bounds.maxY)) / 2,
        )
        .scale(fitK);
    } else {
      // Too large to show legibly: show the top of the tree, centred on its oldest generation.
      const roots = [...layout.persons.values()].filter((p) => p.gen === 0);
      const cx = roots.reduce((s, p) => s + p.x, 0) / Math.max(1, roots.length);
      target = zoomIdentity.translate(size.width / 2 - MIN_FIT_ZOOM * cx, 40).scale(MIN_FIT_ZOOM);
    }
    if (zoomRef.current) zoomRef.current.transform(select(svgRef.current!), target);
  }, [fitNonce, size, layout]);

  useEffect(() => {
    if (!focus || !size.width) return;
    const box = layout.persons.get(focus.id);
    if (!box) return;
    const k = Math.max(transform.k, 0.8);
    // On narrow screens the person panel covers the lower part, so aim higher.
    const cy = size.width < 720 ? size.height * 0.2 : size.height / 2;
    animateTo(zoomIdentity.translate(size.width / 2 - k * box.x, cy - k * (box.y + NODE_H / 2)).scale(k));
    // Only re-centre when a new focus request arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, size.width > 0]);

  /** Zooms so that all given boxes are visible. */
  const fitBoxes = (boxes: PersonBox[]) => {
    const minX = Math.min(...boxes.map((b) => b.x)) - NODE_W / 2;
    const maxX = Math.max(...boxes.map((b) => b.x)) + NODE_W / 2;
    const minY = Math.min(...boxes.map((b) => b.y));
    const maxY = Math.max(...boxes.map((b) => b.y)) + NODE_H;
    const k = Math.max(0.05, Math.min(1, (0.8 * size.width) / (maxX - minX), (0.75 * size.height) / (maxY - minY)));
    animateTo(
      zoomIdentity
        .translate(size.width / 2 - (k * (minX + maxX)) / 2, size.height / 2 + 40 - (k * (minY + maxY)) / 2)
        .scale(k),
    );
  };

  // Zoom to a newly shown path so both ends are visible.
  const fittedPath = useRef<PathStep[] | null>(null);
  useEffect(() => {
    if (!path || !size.width || fittedPath.current === path) return;
    const boxes = path.map((s) => layout.persons.get(s.id)).filter((b): b is PersonBox => !!b);
    if (boxes.length !== path.length) return;
    fittedPath.current = path;
    fitBoxes(boxes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, layout, size.width > 0]);

  // Zoom to a newly highlighted group once its members are laid out.
  const fittedHighlight = useRef<Set<Id> | null>(null);
  useEffect(() => {
    if (!highlight?.size || !size.width || fittedHighlight.current === highlight) return;
    const boxes = [...highlight].map((id) => layout.persons.get(id)).filter((b): b is PersonBox => !!b);
    if (boxes.length !== highlight.size) return;
    fittedHighlight.current = highlight;
    fitBoxes(boxes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlight, layout, size.width > 0]);

  const pathIds = useMemo(() => new Set(path?.map((s) => s.id)), [path]);
  const marked = path ? pathIds : highlight?.size ? highlight : null;
  const pathD = useMemo(() => (path ? pathGeometry(path, layout) : ''), [path, layout]);

  const grids = useMemo(() => {
    const persons = new SpatialGrid<PersonBox>();
    for (const p of layout.persons.values()) {
      persons.insert(p, { minX: p.x - NODE_W / 2, maxX: p.x + NODE_W / 2, minY: p.y, maxY: p.y + NODE_H });
    }
    const unions = new SpatialGrid<UnionGeometry>();
    for (const u of layout.unions) unions.insert(u, { minX: u.minX, maxX: u.maxX, minY: u.y, maxY: u.maxY });
    return { persons, unions };
  }, [layout]);

  const view = {
    minX: (-transform.x - CULL_MARGIN) / transform.k,
    minY: (-transform.y - CULL_MARGIN) / transform.k,
    maxX: (size.width - transform.x + CULL_MARGIN) / transform.k,
    maxY: (size.height - transform.y + CULL_MARGIN) / transform.k,
  };
  const visiblePersons = size.width ? [...grids.persons.query(view)] : [];
  const visibleUnions = size.width ? [...grids.unions.query(view)] : [];
  const detailed = transform.k >= DETAIL_ZOOM;
  const count = layout.persons.size;

  return (
    <div className="canvas">
      <svg ref={svgRef} className="tree-svg" onClick={(e) => e.target === e.currentTarget && onSelect(null)}>
        <defs>
          <clipPath id="avatar-clip" clipPathUnits="objectBoundingBox">
            <circle cx={0.5} cy={0.5} r={0.5} />
          </clipPath>
        </defs>
        <g transform={transform.toString()}>
          <g className={`edges${marked ? ' dimmed' : ''}`}>
            {visibleUnions.map((u) => (
              <UnionEdges key={u.id} union={u} layout={layout} />
            ))}
          </g>
          {pathD && <path d={pathD} className="path-edge" />}
          <g className="nodes">
            {visiblePersons.map((box) => (
              <PersonNode
                key={box.id}
                box={box}
                person={tree.persons[box.id]}
                selected={box.id === selectedId}
                detailed={detailed}
                truncated={truncated.has(box.id)}
                isFocusRoot={box.id === focusRoot}
                pathState={marked ? (marked.has(box.id) ? 'on' : 'off') : undefined}
                onSelect={onSelect}
                onFocusOn={onFocusOn}
              />
            ))}
          </g>
        </g>
      </svg>
      {count === 0 && (
        <div className="empty">
          <p>A családfa még üres.</p>
          {onAddFirst && (
            <button className="primary" onClick={onAddFirst}>
              Első személy hozzáadása
            </button>
          )}
        </div>
      )}
      <div className="status">
        {focusRoot ? `${count} / ${Object.keys(tree.persons).length}` : count} személy · {visiblePersons.length} látható
        · {transform.k < 0.1 ? (transform.k * 100).toFixed(1) : Math.round(transform.k * 100)}%
      </div>
    </div>
  );
}

const UnionEdges = memo(function UnionEdges({ union, layout }: { union: UnionGeometry; layout: Layout }) {
  const partners = union.partners.map((p) => layout.persons.get(p)).filter((p): p is PersonBox => !!p);
  const kids = union.children.map((c) => layout.persons.get(c)).filter((p): p is PersonBox => !!p);
  const parts: string[] = [];
  if (partners.length === 2) {
    const [a, b] = [...partners].sort((p, q) => p.x - q.x);
    const y = a.y + NODE_H / 2;
    parts.push(`M${a.x + NODE_W / 2},${y}H${b.x - NODE_W / 2}`);
  }
  if (kids.length) {
    const xs = [union.x, ...kids.map((k) => k.x)];
    parts.push(`M${union.x},${union.y}V${union.barY}`);
    parts.push(`M${Math.min(...xs)},${union.barY}H${Math.max(...xs)}`);
    for (const k of kids) parts.push(`M${k.x},${union.barY}V${k.y}`);
  }
  return (
    <>
      <path d={parts.join('')} className="edge" />
      {partners.length === 2 && <circle cx={union.x} cy={union.y} r={4} className="union-dot" />}
    </>
  );
});

const years = (p: Person) => {
  if (p.birthYear == null && p.deathYear == null) return '';
  return `${p.birthYear ?? '?'} – ${p.deathYear ?? ''}`.trim();
};

const PersonNode = memo(function PersonNode({
  box,
  person,
  selected,
  detailed,
  truncated,
  isFocusRoot,
  pathState,
  onSelect,
  onFocusOn,
}: {
  box: PersonBox;
  person: Person;
  selected: boolean;
  detailed: boolean;
  truncated: boolean;
  isFocusRoot: boolean;
  pathState?: 'on' | 'off';
  onSelect: (id: Id) => void;
  onFocusOn: (id: Id) => void;
}) {
  const name = fullName(person);
  const textX = person.photo ? 22 + AVATAR : 16;
  const maxChars = person.photo ? 15 : 20;
  return (
    <g
      className={`person gender-${person.gender}${selected ? ' selected' : ''}${isFocusRoot ? ' focus-root' : ''}${person.deathYear != null ? ' deceased' : ''}${person.redacted ? ' redacted' : ''}${detailed ? '' : ' overview'}${pathState ? ` path-${pathState}` : ''}`}
      transform={`translate(${box.x - NODE_W / 2},${box.y})`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(box.id);
      }}
    >
      <rect width={NODE_W} height={NODE_H} rx={10} className="card" />
      <rect width={6} height={NODE_H} rx={3} className="stripe" />
      {detailed && person.photo && (
        <>
          <image
            href={person.photo}
            x={14}
            y={(NODE_H - AVATAR) / 2}
            width={AVATAR}
            height={AVATAR}
            clipPath="url(#avatar-clip)"
            preserveAspectRatio="xMidYMid slice"
          />
          <circle cx={14 + AVATAR / 2} cy={NODE_H / 2} r={AVATAR / 2} className="avatar-ring" />
        </>
      )}
      {detailed && (
        <>
          <text x={textX} y={25} className="name">
            {name.length > maxChars ? `${name.slice(0, maxChars - 1)}…` : name}
          </text>
          <text x={textX} y={45} className="years">
            {years(person)}
          </text>
        </>
      )}
      {detailed && truncated && (
        <g
          className="more"
          transform={`translate(${NODE_W - 14},14)`}
          onClick={(e) => {
            e.stopPropagation();
            onFocusOn(box.id);
          }}
        >
          <title>További rokonok – nézet áthelyezése ide</title>
          <circle r={9} />
          <path d="M-4,0H4M0,-4V4" />
        </g>
      )}
      <title>{name}</title>
    </g>
  );
});

/** SVG path tracing the actual tree lines between consecutive people of a relationship path. */
function pathGeometry(path: PathStep[], layout: Layout): string {
  const parts: string[] = [];
  for (let i = 1; i < path.length; i++) {
    const a = layout.persons.get(path[i - 1].id);
    const b = layout.persons.get(path[i].id);
    if (!a || !b) continue;
    if (path[i].relation === 'partner') {
      const [l, r] = a.x < b.x ? [a, b] : [b, a];
      parts.push(`M${l.x + NODE_W / 2},${l.y + NODE_H / 2}H${r.x - NODE_W / 2}`);
      continue;
    }
    const [parent, child] = path[i].relation === 'parent' ? [b, a] : [a, b];
    const union = layout.unions.find((u) => u.children.includes(child.id) && u.partners.includes(parent.id));
    if (!union) continue;
    if (union.partners.length === 2) {
      const side = union.x > parent.x ? NODE_W / 2 : -NODE_W / 2;
      parts.push(`M${parent.x + side},${parent.y + NODE_H / 2}H${union.x}`);
    }
    parts.push(`M${union.x},${union.y}V${union.barY}H${child.x}V${child.y}`);
  }
  return parts.join('');
}
