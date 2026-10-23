import { buildIndex, type TreeIndex } from '../model/graph';
import type { FamilyTree, Id } from '../model/types';

/**
 * Layered ("Sugiyama-style") layout for family graphs.
 *
 * 1. Assign every person a generation (row) by walking relationships.
 * 2. Group partners in the same generation into blocks that move together.
 * 3. Order blocks inside each row with DFS + barycenter sweeps to reduce crossings.
 * 4. Assign x coordinates by alternately centring parents over children and
 *    children under parents, resolving overlaps with a balanced left/right pass.
 *
 * Every step is roughly O(n log n), so trees with thousands of people lay out
 * in milliseconds; rendering stays fast via viewport culling (see SpatialGrid).
 */

export const NODE_W = 172;
export const NODE_H = 60;
export const PARTNER_GAP = 18;
export const BLOCK_GAP = 34;
export const ROW_H = 150;

export interface PersonBox {
  id: Id;
  /** Centre x. */
  x: number;
  /** Top y. */
  y: number;
  gen: number;
}

export interface UnionGeometry {
  id: Id;
  partners: Id[];
  children: Id[];
  /** Point the child connector starts from. */
  x: number;
  y: number;
  /** Y of the horizontal bar above the children (if any). */
  barY: number;
  minX: number;
  maxX: number;
  maxY: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Layout {
  persons: Map<Id, PersonBox>;
  unions: UnionGeometry[];
  bounds: Bounds;
}

interface Block {
  members: Id[];
  gen: number;
  x: number; // left edge
  width: number;
}

const STEP = NODE_W + PARTNER_GAP;
/** How much more a person's siblings than their parents decide which side of a couple they stand on. */
const SIBLING_PULL = 2;

export function computeLayout(tree: FamilyTree, index: TreeIndex = buildIndex(tree)): Layout {
  const ids = Object.keys(tree.persons);
  const gen = assignGenerations(tree, index, ids);
  const { blocks, blockOf } = buildBlocks(tree, index, ids, gen);
  const layers = initialOrder(tree, index, ids, gen, blocks, blockOf);
  bestOrdering(tree, index, layers, blockOf);
  assignX(tree, index, layers, blockOf);
  return buildGeometry(tree, layers);
}

function assignGenerations(tree: FamilyTree, index: TreeIndex, ids: Id[]): Map<Id, number> {
  const gen = new Map<Id, number>();
  for (const start of ids) {
    if (gen.has(start)) continue;
    const component: Id[] = [];
    const queue: Id[] = [start];
    gen.set(start, 0);
    const set = (id: Id, g: number) => {
      if (!gen.has(id)) {
        gen.set(id, g);
        queue.push(id);
      }
    };
    for (let i = 0; i < queue.length; i++) {
      const cur = queue[i];
      component.push(cur);
      const g = gen.get(cur)!;
      for (const uid of index.partnerUnions.get(cur) ?? []) {
        const u = tree.unions[uid];
        u.partners.forEach((p) => set(p, g));
        u.children.forEach((c) => set(c, g + 1));
      }
      const pu = index.parentUnion.get(cur);
      if (pu) {
        const u = tree.unions[pu];
        u.partners.forEach((p) => set(p, g - 1));
        u.children.forEach((c) => set(c, g));
      }
    }
    let min = Infinity;
    for (const id of component) min = Math.min(min, gen.get(id)!);
    for (const id of component) gen.set(id, gen.get(id)! - min);
  }
  return gen;
}

function buildBlocks(tree: FamilyTree, index: TreeIndex, ids: Id[], gen: Map<Id, number>) {
  const blocks: Block[] = [];
  const blockOf = new Map<Id, Block>();
  const samePartners = (id: Id) => {
    const out: Id[] = [];
    for (const uid of index.partnerUnions.get(id) ?? []) {
      for (const p of tree.unions[uid].partners) if (p !== id && gen.get(p) === gen.get(id)) out.push(p);
    }
    return out;
  };
  for (const id of ids) {
    if (blockOf.has(id)) continue;
    // Collect the partner-connected group, then walk it from an end so chains
    // like "1st spouse - person - 2nd spouse" keep partners adjacent.
    const group: Id[] = [id];
    const seen = new Set([id]);
    for (let i = 0; i < group.length; i++) {
      for (const p of samePartners(group[i])) if (!seen.has(p)) (seen.add(p), group.push(p));
    }
    const start = group.find((m) => samePartners(m).length <= 1) ?? id;
    const members: Id[] = [];
    const visited = new Set<Id>();
    const stack = [start];
    while (stack.length) {
      const cur = stack.pop()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      members.push(cur);
      stack.push(...samePartners(cur).reverse());
    }
    const block: Block = {
      members,
      gen: gen.get(id)!,
      x: 0,
      width: members.length * STEP - PARTNER_GAP,
    };
    blocks.push(block);
    members.forEach((m) => blockOf.set(m, block));
  }
  return { blocks, blockOf };
}

function initialOrder(
  tree: FamilyTree,
  index: TreeIndex,
  ids: Id[],
  gen: Map<Id, number>,
  blocks: Block[],
  blockOf: Map<Id, Block>,
): Block[][] {
  const maxGen = blocks.reduce((m, b) => Math.max(m, b.gen), 0);
  const layers: Block[][] = Array.from({ length: maxGen + 1 }, () => []);
  const visited = new Set<Block>();
  const roots = [...ids].sort((a, b) => gen.get(a)! - gen.get(b)!);
  for (const root of roots) {
    const stack: Block[] = [blockOf.get(root)!];
    while (stack.length) {
      const block = stack.pop()!;
      if (visited.has(block)) continue;
      visited.add(block);
      layers[block.gen].push(block);
      const next: Block[] = [];
      for (const m of block.members) {
        for (const uid of index.partnerUnions.get(m) ?? []) {
          for (const c of tree.unions[uid].children) next.push(blockOf.get(c)!);
        }
      }
      for (const m of block.members) {
        const pu = index.parentUnion.get(m);
        if (pu) for (const p of tree.unions[pu].partners) next.push(blockOf.get(p)!);
      }
      for (let i = next.length - 1; i >= 0; i--) if (!visited.has(next[i])) stack.push(next[i]);
    }
  }
  return layers;
}

/**
 * Barycenter sweeps at person level: each person's position is its slot in the
 * row, so a couple whose two members descend from different families can be
 * judged member by member. Each sweep first turns every couple (or chain of
 * partners) to face its members' own relatives, e.g. a wife married in next to
 * her parents' side, then orders the blocks of the row by their barycenters.
 */
/**
 * Runs the crossing reduction with and without the sibling pull and keeps the
 * ordering with fewer crossing lines (the sibling pull wins ties, as it reads
 * better: in-laws on the outside, their families next to them).
 */
function bestOrdering(tree: FamilyTree, index: TreeIndex, layers: Block[][], blockOf: Map<Id, Block>) {
  const snapshot = () => ({
    rows: layers.map((l) => [...l]),
    members: new Map(layers.flat().map((b) => [b, [...b.members]])),
  });
  const restore = (s: ReturnType<typeof snapshot>) => {
    s.rows.forEach((row, g) => (layers[g] = [...row]));
    for (const [b, m] of s.members) b.members = [...m];
  };
  const initial = snapshot();
  let best = initial;
  let bestScore = Infinity;
  for (const [pull, together] of [
    [SIBLING_PULL, true],
    [0, true],
    [SIBLING_PULL, false],
    [0, false],
  ] as const) {
    restore(initial);
    reduceCrossings(tree, index, layers, blockOf, pull, together);
    const score = countRowCrossings(tree, index, layers, blockOf);
    if (score < bestScore) {
      best = snapshot();
      bestScore = score;
    }
  }
  restore(best);
}

/**
 * Crossings of parent→child lines in the current row order, in O(E log E) per pair
 * of rows, plus the cards a sibling line runs over without being related to them.
 */
function countRowCrossings(tree: FamilyTree, index: TreeIndex, layers: Block[][], blockOf: Map<Id, Block>): number {
  const slot = new Map<Id, number>();
  for (const layer of layers) {
    let i = 0;
    for (const b of layer) for (const m of b.members) slot.set(m, i++);
  }
  const edgesByRow = new Map<number, [number, number][]>();
  for (const u of Object.values(tree.unions)) {
    if (!u.children.length) continue;
    const upper = u.partners.reduce((sum, p) => sum + slot.get(p)!, 0) / u.partners.length;
    const gen = blockOf.get(u.partners[0])!.gen;
    for (const c of u.children) {
      if (blockOf.get(c)!.gen !== gen + 1) continue;
      const row = edgesByRow.get(gen) ?? [];
      row.push([upper, slot.get(c)!]);
      edgesByRow.set(gen, row);
    }
  }
  let total = 0;
  for (const edges of edgesByRow.values()) {
    edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    total += inversions(edges.map((e) => e[1]));
  }
  for (const u of Object.values(tree.unions)) {
    const gen = blockOf.get(u.partners[0])!.gen;
    const kids = u.children.filter((c) => blockOf.get(c)!.gen === gen + 1);
    if (kids.length < 2) continue;
    const slots = kids.map((c) => slot.get(c)!);
    const lo = Math.min(...slots);
    const hi = Math.max(...slots);
    const inside = new Set(kids);
    for (const c of kids) {
      for (const uid of index.partnerUnions.get(c) ?? []) {
        for (const p of tree.unions[uid].partners) {
          if (slot.get(p)! > lo && slot.get(p)! < hi && blockOf.get(p)!.gen === gen + 1) inside.add(p);
        }
      }
    }
    total += hi - lo + 1 - inside.size;
  }
  return total;
}

function inversions(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mid = xs.length >> 1;
  const left = xs.slice(0, mid);
  const right = xs.slice(mid);
  let count = inversions(left) + inversions(right);
  let i = 0;
  let j = 0;
  let k = 0;
  while (i < left.length && j < right.length) {
    if (left[i] <= right[j]) xs[k++] = left[i++];
    else {
      xs[k++] = right[j++];
      count += left.length - i;
    }
  }
  while (i < left.length) xs[k++] = left[i++];
  while (j < right.length) xs[k++] = right[j++];
  return count;
}

function reduceCrossings(
  tree: FamilyTree,
  index: TreeIndex,
  layers: Block[][],
  blockOf: Map<Id, Block>,
  siblingPull: number,
  together: boolean,
) {
  const slot = new Map<Id, number>();
  const blockPos = new Map<Block, number>();
  const record = (layer: Block[]) => {
    let i = 0;
    layer.forEach((b, bi) => {
      blockPos.set(b, bi);
      for (const m of b.members) slot.set(m, i++);
    });
  };
  layers.forEach(record);

  const parentsIn = (m: Id, gen: number) => {
    const pu = index.parentUnion.get(m);
    return pu ? tree.unions[pu].partners.filter((p) => blockOf.get(p)!.gen === gen) : [];
  };
  const childrenIn = (m: Id, gen: number) => {
    const out: Id[] = [];
    for (const uid of index.partnerUnions.get(m) ?? []) {
      for (const c of tree.unions[uid].children) if (blockOf.get(c)!.gen === gen) out.push(c);
    }
    return out;
  };

  const sweep = (g: number, neighbours: (m: Id) => Id[]) => {
    const layer = layers[g];
    const bary = new Map<Id, number>();
    for (const b of layer) {
      for (const m of b.members) {
        const ns = neighbours(m);
        if (ns.length) bary.set(m, ns.reduce((sum, n) => sum + slot.get(n)!, 0) / ns.length);
      }
    }
    // Turn partner chains towards their relatives (reversal keeps partners adjacent):
    // each member is pulled towards its neighbours in the swept row and, more
    // strongly, towards its own siblings, so people who married in end up on the
    // outer side of the sibling group, where their own family can sit above them.
    for (const b of layer) {
      if (b.members.length < 2) continue;
      const base = slot.get(b.members[0])!;
      const siblingTarget = new Map<Id, number>();
      for (const m of b.members) {
        const pu = index.parentUnion.get(m);
        const sibs = pu
          ? tree.unions[pu].children.filter((c) => blockOf.get(c) !== b && blockOf.get(c)!.gen === g)
          : [];
        if (sibs.length) siblingTarget.set(m, sibs.reduce((sum, c) => sum + slot.get(c)!, 0) / sibs.length);
      }
      const cost = (order: Id[]) =>
        order.reduce((c, m, i) => {
          const pos = base + i;
          if (bary.has(m)) c += Math.abs(pos - bary.get(m)!);
          if (siblingTarget.has(m)) c += siblingPull * Math.abs(pos - siblingTarget.get(m)!);
          return c;
        }, 0);
      const reversed = [...b.members].reverse();
      if (cost(reversed) < cost(b.members)) b.members = reversed;
    }
    let carry = -1;
    const keys = new Map<Block, number>();
    for (const b of layer) {
      const known = b.members.filter((m) => bary.has(m));
      if (known.length) carry = known.reduce((sum, m) => sum + bary.get(m)!, 0) / known.length;
      // Blocks without neighbours stick to the block before them.
      keys.set(b, carry);
    }
    layer.sort((a, b) => keys.get(a)! - keys.get(b)! || blockPos.get(a)! - blockPos.get(b)!);
    record(layer);
  };

  const down = () => {
    for (let g = 1; g < layers.length; g++) sweep(g, (m) => parentsIn(m, g - 1));
  };
  const up = () => {
    for (let g = layers.length - 2; g >= 0; g--) sweep(g, (m) => childrenIn(m, g + 1));
  };
  for (let iter = 0; iter < 6; iter++) {
    down();
    up();
  }
  down();

  // Local refinement: swap neighbouring blocks, or turn a partner chain around,
  // whenever that removes crossings. Only the edges of the two blocks involved
  // can change their crossings, so each test is cheap and a pass stays O(edges).
  interface Edge {
    up: boolean; // to the generation above, else below
    self: number; // position in this row
    other: number; // position in the neighbouring row
  }
  const unionPos = (uid: Id) => {
    const ps = tree.unions[uid].partners;
    return ps.reduce((sum, p) => sum + slot.get(p)!, 0) / ps.length;
  };
  const edgesOf = (b: Block, selfOf: (m: Id) => number): Edge[] => {
    const out: Edge[] = [];
    const seen = new Set<Id>();
    for (const m of b.members) {
      const pu = index.parentUnion.get(m);
      if (pu && blockOf.get(tree.unions[pu].partners[0])!.gen === b.gen - 1) {
        out.push({ up: true, self: selfOf(m), other: unionPos(pu) });
      }
      for (const uid of index.partnerUnions.get(m) ?? []) {
        if (seen.has(uid)) continue;
        seen.add(uid);
        const ps = tree.unions[uid].partners;
        const self = ps.reduce((sum, p) => sum + selfOf(p), 0) / ps.length;
        for (const c of tree.unions[uid].children) {
          if (blockOf.get(c)!.gen === b.gen + 1) out.push({ up: false, self, other: slot.get(c)! });
        }
      }
    }
    return out;
  };
  /** Crossings among one set of edges, given their positions. */
  const internalCrossings = (edges: Edge[]) => {
    let n = 0;
    for (let i = 0; i < edges.length; i++) {
      for (let j = i + 1; j < edges.length; j++) {
        const a = edges[i];
        const b = edges[j];
        if (a.up === b.up && (a.self - b.self) * (a.other - b.other) < 0) n++;
      }
    }
    return n;
  };
  /** Crossings between edges of a block on the left and a block on the right. */
  const between = (left: Edge[], right: Edge[]) => {
    let n = 0;
    for (const a of left) for (const b of right) if (a.up === b.up && a.other > b.other) n++;
    return n;
  };

  // Lines may only connect relatives: a block with no parents in the row above
  // must not sit between siblings, or their shared line would run over it.
  const parentUnions = (b: Block) => {
    const out: Id[] = [];
    for (const m of b.members) {
      const pu = index.parentUnion.get(m);
      if (pu && blockOf.get(tree.unions[pu].partners[0])!.gen === b.gen - 1) out.push(pu);
    }
    return out;
  };
  const splitsSiblings = (layer: Block[], i: number) => {
    if (i === 0 || i + 1 >= layer.length || parentUnions(layer[i]).length) return false;
    const left = new Set(parentUnions(layer[i - 1]));
    return parentUnions(layer[i + 1]).some((pu) => left.has(pu));
  };
  /** Crossings between the edges of one block and the rest of its row. */
  const crossingsOf = (layer: Block[], b: Block) => {
    const own = (m: Id) => slot.get(m)!;
    const mine = edgesOf(b, own);
    let n = 0;
    for (const other of layer) {
      if (other === b) continue;
      for (const e of edgesOf(other, own)) {
        for (const f of mine) if (e.up === f.up && (e.self - f.self) * (e.other - f.other) < 0) n++;
      }
    }
    return n;
  };
  /**
   * Moves blocks without parents out of sibling groups, to the side where they
   * cross fewer lines; unless `force`, only when that costs fewer crossings than
   * the cards a sibling line would run over.
   */
  const keepSiblingsTogether = (layer: Block[], force: boolean) => {
    const spans = new Map<Id, [number, number]>();
    layer.forEach((b, i) => {
      for (const pu of parentUnions(b)) {
        const span = spans.get(pu);
        spans.set(pu, span ? [span[0], i] : [i, i]);
      }
    });
    const groups: [number, number][] = [];
    for (const span of [...spans.values()].sort((x, y) => x[0] - y[0])) {
      const last = groups[groups.length - 1];
      if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
      else groups.push([...span]);
    }
    const costAt = (b: Block, i: number) => {
      layer.splice(i, 0, b);
      record(layer);
      const cost = crossingsOf(layer, b);
      layer.splice(i, 1);
      return cost;
    };
    let moved = false;
    for (const [first, last] of groups.reverse()) {
      const head = layer[first];
      const tail = layer[last];
      for (const b of layer.slice(first + 1, last).filter((x) => !parentUnions(x).length)) {
        const at = layer.indexOf(b);
        const stay = force ? Infinity : crossingsOf(layer, b) + b.members.length;
        layer.splice(at, 1);
        const left = layer.indexOf(head);
        const right = layer.indexOf(tail) + 1;
        const leftCost = costAt(b, left);
        const rightCost = costAt(b, right);
        const nearLeft = at - left <= right - at;
        const best = leftCost < rightCost || (leftCost === rightCost && nearLeft) ? left : right;
        if (Math.min(leftCost, rightCost) < stay) {
          layer.splice(best, 0, b);
          moved = true;
        } else layer.splice(at, 0, b);
        record(layer);
      }
    }
    return moved;
  };

  for (let pass = 0; pass < 4; pass++) {
    let improved = false;
    for (const layer of layers) {
      for (const b of layer) {
        if (b.members.length < 2) continue;
        const reversed = [...b.members].reverse();
        const local = (order: Id[]) => (m: Id) => order.indexOf(m);
        if (internalCrossings(edgesOf(b, local(reversed))) < internalCrossings(edgesOf(b, local(b.members)))) {
          b.members = reversed;
          improved = true;
        }
      }
      record(layer);
      for (let i = 0; i + 1 < layer.length; i++) {
        const own = (m: Id) => slot.get(m)!;
        const a = edgesOf(layer[i], own);
        const b = edgesOf(layer[i + 1], own);
        if (between(b, a) < between(a, b)) {
          [layer[i], layer[i + 1]] = [layer[i + 1], layer[i]];
          if (together && (splitsSiblings(layer, i) || splitsSiblings(layer, i + 1))) {
            [layer[i], layer[i + 1]] = [layer[i + 1], layer[i]];
            continue;
          }
          record(layer);
          improved = true;
        }
      }
      if (keepSiblingsTogether(layer, together)) improved = true;
    }
    if (!improved) break;
  }
  for (const layer of layers) keepSiblingsTogether(layer, together);
}

const memberCenter = (block: Block, id: Id) => block.x + block.members.indexOf(id) * STEP + NODE_W / 2;

function unionX(tree: FamilyTree, uid: Id, blockOf: Map<Id, Block>): number {
  const xs = tree.unions[uid].partners.map((p) => memberCenter(blockOf.get(p)!, p));
  return (Math.min(...xs) + Math.max(...xs)) / 2;
}

/** Moves blocks as close to their desired x as possible without overlaps or reordering. */
function resolve(layer: Block[], desired: number[]) {
  const n = layer.length;
  if (!n) return;
  const left = new Array<number>(n);
  const right = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    left[i] = i === 0 ? desired[i] : Math.max(desired[i], left[i - 1] + layer[i - 1].width + BLOCK_GAP);
  }
  for (let i = n - 1; i >= 0; i--) {
    right[i] = i === n - 1 ? desired[i] : Math.min(desired[i], right[i + 1] - layer[i].width - BLOCK_GAP);
  }
  // Both passes satisfy the spacing constraints, so does their average.
  for (let i = 0; i < n; i++) layer[i].x = (left[i] + right[i]) / 2;
}

function assignX(tree: FamilyTree, index: TreeIndex, layers: Block[][], blockOf: Map<Id, Block>) {
  for (const layer of layers) {
    let x = 0;
    for (const b of layer) {
      b.x = x;
      x += b.width + BLOCK_GAP;
    }
  }

  const alignToParents = (g: number) => {
    const layer = layers[g];
    // Centre each sibling group (in current row order) under its parents' union.
    const groupStart = new Map<Id, number>();
    const groupWidth = new Map<Id, number>();
    const seenInGroup = new Map<Id, Set<Block>>();
    for (const b of layer) {
      for (const m of b.members) {
        const pu = index.parentUnion.get(m);
        if (!pu) continue;
        const seen = seenInGroup.get(pu) ?? new Set<Block>();
        if (seen.has(b)) continue;
        seen.add(b);
        seenInGroup.set(pu, seen);
        groupWidth.set(pu, (groupWidth.get(pu) ?? -BLOCK_GAP) + b.width + BLOCK_GAP);
      }
    }
    const desired = layer.map((b) => {
      let sum = 0;
      let count = 0;
      for (const m of b.members) {
        const pu = index.parentUnion.get(m);
        if (!pu) continue;
        const parentGen = blockOf.get(tree.unions[pu].partners[0])!.gen;
        if (parentGen !== g - 1) continue;
        const start = groupStart.get(pu) ?? unionX(tree, pu, blockOf) - groupWidth.get(pu)! / 2;
        sum += start;
        count++;
        groupStart.set(pu, start + b.width + BLOCK_GAP);
      }
      return count ? sum / count : b.x;
    });
    resolve(layer, desired);
  };

  const alignToChildren = (g: number) => {
    const layer = layers[g];
    const desired = layer.map((b) => {
      let sum = 0;
      let count = 0;
      const unions = new Set<Id>();
      for (const m of b.members) for (const uid of index.partnerUnions.get(m) ?? []) unions.add(uid);
      for (const uid of unions) {
        const kids = tree.unions[uid].children.filter((c) => blockOf.get(c)!.gen === g + 1);
        if (!kids.length) continue;
        const xs = kids.map((c) => memberCenter(blockOf.get(c)!, c));
        const target = (Math.min(...xs) + Math.max(...xs)) / 2;
        sum += b.x + target - unionX(tree, uid, blockOf);
        count++;
      }
      return count ? sum / count : b.x;
    });
    resolve(layer, desired);
  };

  for (let iter = 0; iter < 8; iter++) {
    for (let g = 1; g < layers.length; g++) alignToParents(g);
    for (let g = layers.length - 2; g >= 0; g--) alignToChildren(g);
  }
}

function buildGeometry(tree: FamilyTree, layers: Block[][]): Layout {
  const persons = new Map<Id, PersonBox>();
  let minX = Infinity;
  let maxX = -Infinity;
  for (const layer of layers) {
    for (const b of layer) {
      minX = Math.min(minX, b.x);
      maxX = Math.max(maxX, b.x + b.width);
    }
  }
  if (!Number.isFinite(minX)) minX = maxX = 0;
  for (const layer of layers) {
    for (const b of layer) {
      b.members.forEach((m, i) => {
        persons.set(m, { id: m, x: b.x - minX + i * STEP + NODE_W / 2, y: b.gen * ROW_H, gen: b.gen });
      });
    }
  }

  const unions: UnionGeometry[] = [];
  for (const u of Object.values(tree.unions)) {
    const ps = u.partners.map((p) => persons.get(p)).filter((p): p is PersonBox => !!p);
    if (!ps.length) continue;
    const pxs = ps.map((p) => p.x);
    const top = Math.max(...ps.map((p) => p.y));
    const x = (Math.min(...pxs) + Math.max(...pxs)) / 2;
    const y = ps.length > 1 ? top + NODE_H / 2 : top + NODE_H;
    const kids = u.children.map((c) => persons.get(c)).filter((p): p is PersonBox => !!p);
    const childTop = kids.length ? Math.min(...kids.map((k) => k.y)) : y;
    const barY = childTop - (ROW_H - NODE_H) / 2;
    const xs = [...pxs, ...kids.map((k) => k.x)];
    unions.push({
      id: u.id,
      partners: u.partners,
      children: u.children,
      x,
      y,
      barY,
      minX: Math.min(...xs) - NODE_W / 2,
      maxX: Math.max(...xs) + NODE_W / 2,
      maxY: Math.max(childTop, top + NODE_H),
    });
  }

  return {
    persons,
    unions,
    bounds: { minX: 0, minY: 0, maxX: maxX - minX, maxY: layers.length * ROW_H - (ROW_H - NODE_H) },
  };
}
