import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { Focus } from '../App';
import { NODE_H, NODE_W, type Layout } from '../layout/layout';
import { computeLayout3D, type Person3D } from '../layout/layout3d';
import { directLinks } from '../layout/links';
import { LinkLegend } from './LinkLegend';
import type { PathStep } from '../model/relationship';
import { fullName, type FamilyTree, type Id, type Person } from '../model/types';

interface Props {
  tree: FamilyTree;
  layout: Layout;
  truncated: Set<Id>;
  focusRoot: Id | null;
  onFocusOn: (id: Id) => void;
  path: PathStep[] | null;
  highlight?: Set<Id> | null;
  /** People where several families shown meet: their connections are drawn and they stand out. */
  hubs?: Set<Id> | null;
  selectedId: Id | null;
  focus: Focus | null;
  fitNonce: number;
  onSelect: (id: Id | null) => void;
  onAddFirst?: () => void;
}

/** Most name labels drawn at once; the nearest people get them. */
const MAX_LABELS = 250;
/** Cards narrower than this on screen get no label. */
const MIN_LABEL_PX = 50;
const FOV = 45;
const CARD_DEPTH = 14;

interface Scene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  root: THREE.Group;
  cards?: THREE.InstancedMesh;
  edges?: THREE.LineSegments;
  ids: Id[];
  /** Wide-line materials, which need the canvas size to draw their width in pixels. */
  wide: Set<LineMaterial>;
  render: () => void;
}

const css = (el: Element, name: string) => getComputedStyle(el).getPropertyValue(name).trim() || '#888';

const years = (p: Person) => {
  if (p.birthYear == null && p.deathYear == null) return '';
  return `${p.birthYear ?? '?'} – ${p.deathYear ?? ''}`.trim();
};

/**
 * 3D view of the tree: the 2D layout wrapped around a cylinder (see
 * layout/layout3d.ts), drawn with WebGL. Cards are one instanced mesh and the
 * lines one line set, so thousands of people stay smooth; names are HTML
 * labels on the nearest cards only.
 */
export default function TreeCanvas3D(props: Props) {
  const { tree, layout, truncated, focusRoot, onFocusOn, path, highlight, hubs, selectedId, focus, fitNonce, onSelect } =
    props;
  const { onAddFirst } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const [autoRotate, setAutoRotate] = useState(false);
  const [webglError, setWebglError] = useState(false);
  const layout3d = useMemo(() => computeLayout3D(layout), [layout]);

  // Latest values for the event handlers and the render loop, which are set up once.
  const live = useRef({ tree, layout3d, truncated, onSelect, onFocusOn });
  live.current = { tree, layout3d, truncated, onSelect, onFocusOn };

  // Renderer, camera, controls and the label pass: created once.
  useEffect(() => {
    const host = hostRef.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setWebglError(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(renderer.domElement);
    renderer.domElement.className = 'tree-3d-gl';

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(FOV, 1, 10, 1e6);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.autoRotateSpeed = 0.6;
    // The wheel zooms towards the point under the cursor, so the cards looked at stay in view.
    controls.zoomToCursor = true;
    // Never straight from above or below: generations read as rows only from the side.
    controls.minPolarAngle = Math.PI * 0.15;
    controls.maxPolarAngle = Math.PI * 0.85;
    scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(1, 2, 3);
    camera.add(sun);
    scene.add(camera);
    const root = new THREE.Group();
    scene.add(root);

    const labels = labelsRef.current!;
    const pool: HTMLDivElement[] = [];
    const v = new THREE.Vector3();
    const toCamera = new THREE.Vector3();

    const updateLabels = () => {
      const { tree, layout3d, truncated } = live.current;
      const w = host.clientWidth;
      const h = host.clientHeight;
      const pxPerUnit = h / 2 / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
      const candidates: { p: Person3D; sx: number; sy: number; k: number; d: number }[] = [];
      for (const p of layout3d.persons.values()) {
        toCamera.set(camera.position.x - p.x, camera.position.y - p.y, camera.position.z - p.z);
        // On a wrapped tree, cards on the far side of the cylinder face away: no label.
        if (layout3d.wrapped && toCamera.x * Math.sin(p.angle) + toCamera.z * Math.cos(p.angle) <= 0) continue;
        const d = toCamera.length();
        const k = pxPerUnit / d;
        if (NODE_W * k < MIN_LABEL_PX) continue;
        v.set(p.x, p.y, p.z).project(camera);
        if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) continue;
        candidates.push({ p, sx: ((v.x + 1) / 2) * w, sy: ((1 - v.y) / 2) * h, k, d });
      }
      candidates.sort((a, b) => a.d - b.d);
      const shown = candidates.slice(0, MAX_LABELS);
      while (pool.length < shown.length) {
        const el = document.createElement('div');
        el.className = 'label-3d';
        el.innerHTML = '<b></b><small></small>';
        labels.appendChild(el);
        pool.push(el);
      }
      pool.forEach((el, i) => {
        const c = shown[i];
        if (!c) {
          el.style.display = 'none';
          return;
        }
        const person = tree.persons[c.p.id];
        if (!person) {
          el.style.display = 'none';
          return;
        }
        const name = fullName(person) + (truncated.has(c.p.id) ? ' +' : '');
        const [b, small] = el.children as unknown as [HTMLElement, HTMLElement];
        if (b.textContent !== name) b.textContent = name;
        const y = years(person);
        if (small.textContent !== y) small.textContent = y;
        el.style.display = '';
        el.style.width = `${NODE_W}px`;
        el.style.height = `${NODE_H}px`;
        // Nearer labels are drawn on top.
        el.style.zIndex = String(MAX_LABELS - i);
        el.style.transform = `translate(${c.sx}px,${c.sy}px) scale(${Math.min(c.k, 1.6)}) translate(-50%,-50%)`;
      });
    };

    const lastEye = new THREE.Vector3(0, 0, 1e9);
    const lastTarget = new THREE.Vector3();
    let frame = 0;
    let dirty = true;
    const render = () => {
      dirty = true;
    };
    const loop = () => {
      frame = requestAnimationFrame(loop);
      // update() returns true while damping or auto-rotation is moving the camera.
      if (controls.update() || dirty) {
        dirty = false;
        // Fog fades the far side of the cylinder so the near side stays readable.
        const { outerRadius: r, wrapped, height, shellRadius } = live.current.layout3d;
        // Zooming in stops just outside the generation looked at, so the camera never passes
        // through the cards (the target is on the axis of a wrapped tree, on the arc of a partial one).
        const t = controls.target;
        controls.minDistance = Math.max(100, shellRadius(t.y) - Math.hypot(t.x, t.z) + NODE_W);
        // The cards face outwards: the camera stays outside the column, so zooming towards the
        // cursor stops in front of the card there instead of passing through it.
        const inside = (p: THREE.Vector3) =>
          Math.abs(p.y) < height / 2 + NODE_H && Math.hypot(p.x, p.z) < shellRadius(p.y) + NODE_W * 0.6;
        if (!inside(camera.position)) {
          lastEye.copy(camera.position);
          lastTarget.copy(t);
        } else if (inside(lastEye)) {
          const least = shellRadius(camera.position.y) + NODE_W * 0.6;
          const a = Math.atan2(camera.position.x, camera.position.z);
          camera.position.set(Math.sin(a) * least, camera.position.y, Math.cos(a) * least);
          camera.lookAt(t);
        } else {
          // Stop where the camera last was outside.
          camera.position.copy(lastEye);
          t.copy(lastTarget);
          camera.lookAt(t);
        }
        // Distance from the camera to the axis of the column. Fog goes by depth, so starting it
        // there fades only the far half of the cylinder, however close the camera comes: zooming
        // in never fades the cards in front.
        const axis = Math.hypot(
          Math.hypot(camera.position.x, camera.position.z),
          Math.max(0, Math.abs(camera.position.y) - height / 2),
        );
        if (scene.fog instanceof THREE.Fog && !wrapped) {
          scene.fog.near = scene.fog.far = 1e9;
        } else if (scene.fog instanceof THREE.Fog) {
          scene.fog.near = axis;
          scene.fog.far = axis + r * 1.2;
        }
        renderer.render(scene, camera);
        updateLabels();
      }
    };
    controls.addEventListener('change', render);
    frame = requestAnimationFrame(loop);

    const resize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      sceneRef.current?.wide.forEach((m) => m.resolution.set(w, h));
      render();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    // Clicks pick the card under the pointer; drags only turn the view.
    const raycaster = new THREE.Raycaster();
    const pick = (e: MouseEvent): Id | null => {
      const s = sceneRef.current;
      if (!s?.cards) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObject(s.cards)[0];
      return hit?.instanceId != null ? s.ids[hit.instanceId] : null;
    };
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      down = null;
      live.current.onSelect(pick(e));
    };
    const onDouble = (e: MouseEvent) => {
      const id = pick(e);
      if (id && live.current.truncated.has(id)) live.current.onFocusOn(id);
    };
    const el = renderer.domElement;
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('dblclick', onDouble);

    sceneRef.current = { renderer, scene, camera, controls, root, ids: [], wide: new Set(), render };
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('dblclick', onDouble);
      controls.dispose();
      root.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      renderer.dispose();
      el.remove();
      pool.forEach((p) => p.remove());
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    s.controls.autoRotate = autoRotate;
    s.render();
  }, [autoRotate]);

  /** Where each card stood before the last change of layout, so a new filter can move them over. */
  const shownBefore = useRef<Map<Id, Person3D> | null>(null);

  // Cards and lines: rebuilt when the layout changes. When the filter changes, the cards
  // glide round the cylinders from where they stood to their new places, new ones grow in,
  // and the lines and names come back once everyone has arrived.
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    for (const child of [...s.root.children]) {
      s.root.remove(child);
      if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }
    const host = hostRef.current!;
    const bg = new THREE.Color(css(host, '--bg'));
    s.scene.background = bg;
    s.scene.fog = new THREE.Fog(bg, 1, 2);
    s.controls.maxDistance = layout3d.outerRadius * 6 + 20000;

    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(layout3d.edges, 3));
    s.edges = new THREE.LineSegments(
      lineGeo,
      new THREE.LineBasicMaterial({ color: css(host, '--edge'), transparent: true }),
    );
    s.root.add(s.edges);

    const ids = [...layout3d.persons.keys()];
    const cards = new THREE.InstancedMesh(
      new THREE.BoxGeometry(NODE_W, NODE_H, CARD_DEPTH),
      new THREE.MeshLambertMaterial(),
      Math.max(1, ids.length),
    );
    cards.count = ids.length;
    const m = new THREE.Object3D();
    /** Places the cards `t` of the way (0–1) from where they stood to their new places. */
    const place = (t: number, from: Map<Id, Person3D> | null) => {
      ids.forEach((id, i) => {
        const p = layout3d.persons.get(id)!;
        const q = from?.get(id);
        if (q && t < 1) {
          // Round the axis, not through it: angle, distance from the axis and height each move.
          let da = p.angle - q.angle;
          da -= Math.round(da / (2 * Math.PI)) * 2 * Math.PI;
          const a = q.angle + da * t;
          const r0 = Math.hypot(q.x, q.z);
          const r = r0 + (Math.hypot(p.x, p.z) - r0) * t;
          m.position.set(r * Math.sin(a), q.y + (p.y - q.y) * t, r * Math.cos(a));
          m.rotation.set(0, a, 0);
          m.scale.set(1, 1, 1);
        } else {
          m.position.set(p.x, p.y, p.z);
          m.rotation.set(0, p.angle, 0);
          const k = from && !q ? Math.max(0.001, t) : 1;
          m.scale.set(k, k, k);
        }
        m.updateMatrix();
        cards.setMatrixAt(i, m.matrix);
      });
      cards.instanceMatrix.needsUpdate = true;
      // three.js culls and picks the cards by a sphere around all of them, computed once and then
      // kept: recompute it as they move, or after a change of filter the cards vanish when zoomed
      // in on, and clicks on them miss.
      cards.computeBoundingSphere();
      cards.computeBoundingBox();
    };
    const from = shownBefore.current;
    shownBefore.current = layout3d.persons;
    s.root.add(cards);
    s.cards = cards;
    s.ids = ids;
    const labels = labelsRef.current!;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!from || still || ![...from.keys()].some((id) => layout3d.persons.has(id))) {
      place(1, null);
      s.render();
      return;
    }
    const MORPH_MS = 700;
    const start = performance.now();
    let frame = 0;
    const others = (visible: boolean) => {
      for (const child of s.root.children) if (child !== cards) child.visible = visible;
      labels.style.opacity = visible ? '' : '0';
    };
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / MORPH_MS);
      const eased = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      place(eased, from);
      others(t >= 1);
      s.render();
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      others(true);
    };
  }, [layout3d]);

  const pathIds = useMemo(() => new Set(path?.map((st) => st.id)), [path]);
  const marked = path ? pathIds : highlight?.size ? highlight : null;

  // Card colours: by gender, with the selection and highlighted people standing out.
  useEffect(() => {
    const s = sceneRef.current;
    if (!s?.cards) return;
    const host = hostRef.current!;
    const surface = new THREE.Color(css(host, '--surface'));
    const bg = new THREE.Color(css(host, '--bg'));
    const accent = new THREE.Color(css(host, '--accent'));
    const byGender: Record<string, THREE.Color> = {};
    for (const g of ['male', 'female', 'other', 'unknown']) {
      byGender[g] = surface.clone().lerp(new THREE.Color(css(host, `--${g}`)), 0.45);
    }
    const c = new THREE.Color();
    s.ids.forEach((id, i) => {
      const person = tree.persons[id];
      c.copy(byGender[person?.gender ?? 'unknown'] ?? byGender.unknown);
      if (id === selectedId || id === focusRoot) c.copy(accent).lerp(surface, 0.35);
      else if (!marked && hubs?.has(id)) c.copy(accent).lerp(surface, 0.6);
      else if (marked && !marked.has(id)) c.lerp(bg, 0.75);
      s.cards!.setColorAt(i, c);
    });
    if (s.cards.instanceColor) s.cards.instanceColor.needsUpdate = true;
    // Other lines step back while a path or group is shown.
    if (s.edges) (s.edges.material as THREE.LineBasicMaterial).opacity = marked ? 0.3 : 1;
    s.render();
  }, [tree, layout3d, selectedId, focusRoot, marked, hubs]);

  // Whose connections are drawn: the selected person's, or else those of the people where the families meet.
  const linked = useMemo(() => (selectedId ? [selectedId] : hubs ? [...hubs] : []), [selectedId, hubs]);
  const links = useMemo(
    () => linked.flatMap((from) => directLinks(layout, from).map((l) => ({ ...l, from }))),
    [layout, linked],
  );

  // Connections drawn as wide coloured lines along the tree's own lines: the relationship
  // path, and the parents, partners and children of the selected person (or where the families meet).
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    const host = hostRef.current!;
    const groups: { points: number[]; color: string; width: number }[] = [];
    const byRelation = { parent: [] as number[], partner: [] as number[], child: [] as number[] };
    for (const l of links) byRelation[l.relation].push(...layout3d.link(l.from, l.id, l.relation));
    for (const r of ['parent', 'partner', 'child'] as const) {
      groups.push({ points: byRelation[r], color: css(host, `--link-${r}`), width: 4 });
    }
    if (path && path.length > 1) {
      const points: number[] = [];
      for (let i = 1; i < path.length; i++)
        points.push(...layout3d.link(path[i - 1].id, path[i].id, path[i].relation!));
      groups.push({ points, color: css(host, '--accent'), width: 6 });
    }
    const added: LineSegments2[] = [];
    for (const g of groups) {
      if (!g.points.length) continue;
      const geo = new LineSegmentsGeometry().setPositions(g.points);
      const mat = new LineMaterial({ color: g.color, linewidth: g.width, worldUnits: false });
      mat.resolution.set(host.clientWidth, host.clientHeight);
      const line = new LineSegments2(geo, mat);
      line.renderOrder = 1;
      s.root.add(line);
      s.wide.add(mat);
      added.push(line);
    }
    s.render();
    return () => {
      for (const line of added) {
        s.root.remove(line);
        line.geometry.dispose();
        line.material.dispose();
        s.wide.delete(line.material);
      }
      s.render();
    };
  }, [path, links, layout3d]);

  /** Moves the camera smoothly so it looks at `target` from `eye`. */
  const flyTo = (target: THREE.Vector3, eye: THREE.Vector3) => {
    const s = sceneRef.current;
    if (!s) return;
    const fromT = s.controls.target.clone();
    const fromE = s.camera.position.clone();
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 600);
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      s.controls.target.lerpVectors(fromT, target, e);
      s.camera.position.lerpVectors(fromE, eye, e);
      s.render();
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  /** Camera distance at which a region `w` wide and `h` tall fills the view. */
  const fitDistance = (w: number, h: number) => {
    const s = sceneRef.current!;
    const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    return Math.max(h / (2 * tan), w / (2 * tan * s.camera.aspect)) * 1.1;
  };

  /** Points the camera at the cylinder axis from outside, facing `angle`. */
  const lookFrom = (
    angle: number,
    cy: number,
    dist: number,
    instant = false,
    surface = layout3d.shellRadius(cy),
    middle = surface,
  ) => {
    const s = sceneRef.current;
    if (!s) return;
    const reach = surface + dist;
    // A wrapped tree turns around the cylinder axis like a column; a partial arc around its own middle.
    const pivot = layout3d.wrapped ? 0 : middle;
    const target = new THREE.Vector3(Math.sin(angle) * pivot, cy, Math.cos(angle) * pivot);
    const eye = new THREE.Vector3(Math.sin(angle) * reach, cy + dist * 0.12, Math.cos(angle) * reach);
    if (instant) {
      s.controls.target.copy(target);
      s.camera.position.copy(eye);
      s.render();
    } else flyTo(target, eye);
  };

  /** Shows a set of people from outside the cylinder. */
  const fitPeople = (people: Person3D[], instant = false) => {
    if (!people.length) return;
    const ys = people.map((p) => p.y);
    const sx = people.reduce((a, p) => a + Math.sin(p.angle), 0);
    const sz = people.reduce((a, p) => a + Math.cos(p.angle), 0);
    const angle = Math.atan2(sx, sz);
    const spread = Math.max(
      ...people.map((p) => Math.abs(Math.atan2(Math.sin(p.angle - angle), Math.cos(p.angle - angle)))),
    );
    // Generations stand on cylinders of different widths: frame the widest one shown.
    const radii = people.map((p) => Math.hypot(p.x, p.z));
    const r = Math.max(...radii);
    const middle = radii.reduce((a, b) => a + b, 0) / radii.length;
    const w = Math.max(2 * r * Math.sin(Math.min(spread, Math.PI / 2)) + NODE_W * 2, NODE_W * 5);
    const h = Math.max(Math.max(...ys) - Math.min(...ys) + NODE_H * 3, NODE_H * 8);
    lookFrom(angle, (Math.max(...ys) + Math.min(...ys)) / 2, fitDistance(w, h), instant, r, middle);
  };

  // Whole tree on first show and whenever requested.
  const fittedFor = useRef(-1);
  useEffect(() => {
    const s = sceneRef.current;
    if (!s || fittedFor.current === fitNonce) return;
    const first = fittedFor.current === -1;
    fittedFor.current = fitNonce;
    const all = [...layout3d.persons.values()];
    if (!all.length) return lookFrom(0, 0, 1500, first);
    // The default view is the outermost cylinder: the youngest generation, at the foot of the tower.
    const youngest = Math.max(...all.map((p) => p.gen));
    const row = all.filter((p) => p.gen === youngest);
    if (!layout3d.wrapped) return fitPeople(row, first);
    const cy = row[0].y;
    const r = Math.max(...row.map((p) => Math.hypot(p.x, p.z)));
    const dist = fitDistance(2 * r, NODE_H * 8);
    const pxPerUnit = s.renderer.domElement.clientHeight / 2 / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    if ((NODE_W * pxPerUnit) / (dist + r) >= 6) {
      // The whole ring, slightly from above.
      lookFrom(0, cy, dist, first, r);
      return;
    }
    // Too wide to show at once: face the middle of the youngest generation.
    const angle = Math.atan2(
      row.reduce((a, p) => a + Math.sin(p.angle), 0),
      row.reduce((a, p) => a + Math.cos(p.angle), 0),
    );
    lookFrom(angle, cy, fitDistance(0, NODE_H * 10), first, r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitNonce, layout3d]);

  useEffect(() => {
    if (!focus) return;
    const p = layout3d.persons.get(focus.id);
    if (p) fitPeople([p]);
    // Only re-centre when a new focus request arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  // Show where the families meet when they are shown: the shared people and their relatives.
  useEffect(() => {
    if (!hubs?.size) return;
    const ids = new Set([...hubs].flatMap((id) => [id, ...directLinks(layout, id).map((l) => l.id)]));
    const people = [...ids].map((id) => layout3d.persons.get(id)).filter((p) => !!p);
    if (people.length) fitPeople(people);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hubs, layout3d]);

  // Show the whole relationship path or family-history group when it appears.
  useEffect(() => {
    if (!marked?.size) return;
    const people = [...marked].map((id) => layout3d.persons.get(id)).filter((p) => !!p);
    if (people.length) fitPeople(people);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marked]);

  const count = layout.persons.size;
  return (
    <div className="canvas canvas-3d">
      <div ref={hostRef} className="tree-3d" />
      <div ref={labelsRef} className="labels-3d" aria-hidden="true" />
      {webglError && (
        <div className="empty">
          <p>A böngésző nem támogatja a 3D megjelenítést (WebGL). Válts vissza 2D nézetre.</p>
        </div>
      )}
      {count === 0 && !webglError && (
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
        {count < Object.keys(tree.persons).length ? `${count} / ${Object.keys(tree.persons).length}` : count} személy · 3D
        <span className="hint-3d"> · húzás: forgatás · görgő: nagyítás · jobb gomb: mozgatás</span>
      </div>
      {links.length > 0 && <LinkLegend links={links} />}
      <label className="rotate-3d">
        <input type="checkbox" checked={autoRotate} onChange={(e) => setAutoRotate(e.target.checked)} />
        Forgatás
      </label>
    </div>
  );
}
