import type { Bounds } from './layout';

/**
 * Uniform grid bucketing for viewport culling: querying the visible rectangle
 * touches only the cells it overlaps, independent of total tree size.
 */
export class SpatialGrid<T> {
  private cells = new Map<string, T[]>();

  constructor(private cellSize = 600) {}

  insert(item: T, b: Bounds) {
    const s = this.cellSize;
    for (let cx = Math.floor(b.minX / s); cx <= Math.floor(b.maxX / s); cx++) {
      for (let cy = Math.floor(b.minY / s); cy <= Math.floor(b.maxY / s); cy++) {
        const key = `${cx}:${cy}`;
        const cell = this.cells.get(key);
        if (cell) cell.push(item);
        else this.cells.set(key, [item]);
      }
    }
  }

  query(b: Bounds): Set<T> {
    const s = this.cellSize;
    const out = new Set<T>();
    for (let cx = Math.floor(b.minX / s); cx <= Math.floor(b.maxX / s); cx++) {
      for (let cy = Math.floor(b.minY / s); cy <= Math.floor(b.maxY / s); cy++) {
        const cell = this.cells.get(`${cx}:${cy}`);
        if (cell) for (const item of cell) out.add(item);
      }
    }
    return out;
  }
}
