import { CHUNK, UNDO_LIMIT } from "../config";

export const EMPTY = 0;
export const STOCK = 1;
/** Solid voxel whose surface was exposed by cutting: rendered brighter. */
export const CUT = 2;

export interface Dims {
  x: number;
  y: number;
  z: number;
}

interface UndoEntry {
  chunks: Map<number, Uint8Array>;
  removed: number;
}

const CHUNK_VOL = CHUNK * CHUNK * CHUNK;

/**
 * Dense voxel grid in one flat array, logically split into CHUNK^3 chunks for
 * dirty tracking, remeshing and undo snapshots. Index layout is x-fastest,
 * then z, then y, so horizontal slices are contiguous.
 */
export class VoxelGrid {
  readonly dims: Dims;
  readonly chunks: Dims;
  readonly data: Uint8Array;
  readonly dirty = new Set<number>();

  private stroke: Map<number, Uint8Array> | null = null;
  private strokeRemoved = 0;
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];

  constructor(dims: Dims, fill = STOCK) {
    this.dims = { ...dims };
    this.chunks = {
      x: Math.ceil(dims.x / CHUNK),
      y: Math.ceil(dims.y / CHUNK),
      z: Math.ceil(dims.z / CHUNK),
    };
    this.data = new Uint8Array(dims.x * dims.y * dims.z).fill(fill);
    this.markAllDirty();
  }

  get chunkCount() {
    return this.chunks.x * this.chunks.y * this.chunks.z;
  }

  index(x: number, y: number, z: number) {
    return x + this.dims.x * (z + this.dims.z * y);
  }

  get(x: number, y: number, z: number): number {
    if (x < 0 || y < 0 || z < 0 || x >= this.dims.x || y >= this.dims.y || z >= this.dims.z) return EMPTY;
    return this.data[x + this.dims.x * (z + this.dims.z * y)];
  }

  chunkId(cx: number, cy: number, cz: number) {
    return cx + this.chunks.x * (cz + this.chunks.z * cy);
  }

  chunkCoords(id: number): [number, number, number] {
    const cx = id % this.chunks.x;
    const cz = Math.floor(id / this.chunks.x) % this.chunks.z;
    const cy = Math.floor(id / (this.chunks.x * this.chunks.z));
    return [cx, cy, cz];
  }

  // -------------------------------------------------------------------------
  // Editing
  // -------------------------------------------------------------------------

  get strokeActive() {
    return this.stroke !== null;
  }

  beginStroke() {
    if (this.stroke) return;
    this.stroke = new Map();
    this.strokeRemoved = 0;
  }

  /** Removes a solid voxel and tags its solid neighbours as freshly cut. Caller guarantees bounds. */
  carve(x: number, y: number, z: number): boolean {
    const i = this.index(x, y, z);
    if (this.data[i] === EMPTY) return false;
    this.write(x, y, z, i, EMPTY);
    this.strokeRemoved++;
    this.tag(x - 1, y, z);
    this.tag(x + 1, y, z);
    this.tag(x, y - 1, z);
    this.tag(x, y + 1, z);
    this.tag(x, y, z - 1);
    this.tag(x, y, z + 1);
    return true;
  }

  private tag(x: number, y: number, z: number) {
    if (x < 0 || y < 0 || z < 0 || x >= this.dims.x || y >= this.dims.y || z >= this.dims.z) return;
    const i = this.index(x, y, z);
    if (this.data[i] === STOCK) this.write(x, y, z, i, CUT);
  }

  private write(x: number, y: number, z: number, i: number, value: number) {
    const cx = (x / CHUNK) | 0;
    const cy = (y / CHUNK) | 0;
    const cz = (z / CHUNK) | 0;
    const id = this.chunkId(cx, cy, cz);
    if (this.stroke && !this.stroke.has(id)) this.stroke.set(id, this.copyChunk(id));
    this.data[i] = value;
    this.dirty.add(id);
    // A voxel on a chunk face changes the visibility of faces owned by the neighbour chunk.
    const lx = x - cx * CHUNK;
    const ly = y - cy * CHUNK;
    const lz = z - cz * CHUNK;
    if (lx === 0 && cx > 0) this.dirty.add(this.chunkId(cx - 1, cy, cz));
    if (lx === CHUNK - 1 && cx < this.chunks.x - 1) this.dirty.add(this.chunkId(cx + 1, cy, cz));
    if (ly === 0 && cy > 0) this.dirty.add(this.chunkId(cx, cy - 1, cz));
    if (ly === CHUNK - 1 && cy < this.chunks.y - 1) this.dirty.add(this.chunkId(cx, cy + 1, cz));
    if (lz === 0 && cz > 0) this.dirty.add(this.chunkId(cx, cy, cz - 1));
    if (lz === CHUNK - 1 && cz < this.chunks.z - 1) this.dirty.add(this.chunkId(cx, cy, cz + 1));
  }

  /** Commits the current stroke to the undo stack. Returns voxels removed by it. */
  endStroke(): number {
    const stroke = this.stroke;
    this.stroke = null;
    if (!stroke || stroke.size === 0) return 0;
    this.undoStack.push({ chunks: stroke, removed: this.strokeRemoved });
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack.length = 0;
    return this.strokeRemoved;
  }

  get undoDepth() {
    return this.undoStack.length;
  }
  get redoDepth() {
    return this.redoStack.length;
  }

  /** Returns the change in removed-voxel count (negative when material comes back). */
  undo(): number | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push(this.swap(entry));
    return -entry.removed;
  }

  redo(): number | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push(this.swap(entry));
    return entry.removed;
  }

  /** Restores the entry's chunks and returns an entry holding the state they replaced. */
  private swap(entry: UndoEntry): UndoEntry {
    const current = new Map<number, Uint8Array>();
    for (const [id, snap] of entry.chunks) {
      current.set(id, this.copyChunk(id));
      this.pasteChunk(id, snap);
    }
    return { chunks: current, removed: entry.removed };
  }

  private chunkRange(id: number) {
    const [cx, cy, cz] = this.chunkCoords(id);
    const x0 = cx * CHUNK, y0 = cy * CHUNK, z0 = cz * CHUNK;
    return {
      x0, y0, z0,
      x1: Math.min(x0 + CHUNK, this.dims.x),
      y1: Math.min(y0 + CHUNK, this.dims.y),
      z1: Math.min(z0 + CHUNK, this.dims.z),
    };
  }

  private copyChunk(id: number): Uint8Array {
    const r = this.chunkRange(id);
    const out = new Uint8Array(CHUNK_VOL);
    for (let y = r.y0; y < r.y1; y++)
      for (let z = r.z0; z < r.z1; z++) {
        const src = this.index(r.x0, y, z);
        out.set(this.data.subarray(src, src + (r.x1 - r.x0)), ((y - r.y0) * CHUNK + (z - r.z0)) * CHUNK);
      }
    return out;
  }

  private pasteChunk(id: number, snap: Uint8Array) {
    const r = this.chunkRange(id);
    for (let y = r.y0; y < r.y1; y++)
      for (let z = r.z0; z < r.z1; z++) {
        const off = ((y - r.y0) * CHUNK + (z - r.z0)) * CHUNK;
        this.data.set(snap.subarray(off, off + (r.x1 - r.x0)), this.index(r.x0, y, z));
      }
    const [cx, cy, cz] = this.chunkCoords(id);
    this.dirty.add(id);
    for (const [dx, dy, dz] of NEIGHBOURS) {
      const nx = cx + dx, ny = cy + dy, nz = cz + dz;
      if (nx >= 0 && ny >= 0 && nz >= 0 && nx < this.chunks.x && ny < this.chunks.y && nz < this.chunks.z)
        this.dirty.add(this.chunkId(nx, ny, nz));
    }
  }

  markAllDirty() {
    for (let i = 0; i < this.chunkCount; i++) this.dirty.add(i);
  }

  countSolid(): number {
    let n = 0;
    for (let i = 0; i < this.data.length; i++) if (this.data[i] !== EMPTY) n++;
    return n;
  }
}

const NEIGHBOURS: [number, number, number][] = [
  [-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1],
];
