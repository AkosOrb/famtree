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

export function computeLayout(tree: FamilyTree, index: TreeIndex = buildIndex(tree)): Layout {
  const ids = Object.keys(tree.persons);
  const gen = assignGenerations(tree, index, ids);
  const { blocks, blockOf } = buildBlocks(tree, index, ids, gen);
  const layers = initialOrder(tree, index, ids, gen, blocks, blockOf);
  reduceCrossings(tree, index, layers, blockOf);
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

function parentBlocks(tree: FamilyTree, index: TreeIndex, block: Block, blockOf: Map<Id, Block>): Block[] {
  const out: Block[] = [];
  for (const m of block.members) {
    const pu = index.parentUnion.get(m);
    if (pu) for (const p of tree.unions[pu].partners) out.push(blockOf.get(p)!);
  }
  return out;
}

function childBlocks(tree: FamilyTree, index: TreeIndex, block: Block, blockOf: Map<Id, Block>): Block[] {
  const out: Block[] = [];
  for (const m of block.members) {
    for (const uid of index.partnerUnions.get(m) ?? []) {
      for (const c of tree.unions[uid].children) out.push(blockOf.get(c)!);
    }
  }
  return out;
}

function reduceCrossings(tree: FamilyTree, index: TreeIndex, layers: Block[][], blockOf: Map<Id, Block>) {
  const pos = new Map<Block, number>();
  const record = () => layers.forEach((layer) => layer.forEach((b, i) => pos.set(b, i)));
  record();
  const sweep = (g: number, neighbours: (b: Block) => Block[], neighbourGen: number) => {
    const layer = layers[g];
    let carry = -1;
    const keys = new Map<Block, number>();
    for (const b of layer) {
      const ns = neighbours(b).filter((n) => n.gen === neighbourGen);
      if (ns.length) carry = ns.reduce((s, n) => s + pos.get(n)!, 0) / ns.length;
      // Blocks without neighbours stick to the block before them.
      keys.set(b, carry);
    }
    layer.sort((a, b) => keys.get(a)! - keys.get(b)! || pos.get(a)! - pos.get(b)!);
    layer.forEach((b, i) => pos.set(b, i));
  };
  for (let iter = 0; iter < 4; iter++) {
    for (let g = 1; g < layers.length; g++) sweep(g, (b) => parentBlocks(tree, index, b, blockOf), g - 1);
    for (let g = layers.length - 2; g >= 0; g--) sweep(g, (b) => childBlocks(tree, index, b, blockOf), g + 1);
  }
  for (let g = 1; g < layers.length; g++) sweep(g, (b) => parentBlocks(tree, index, b, blockOf), g - 1);
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
