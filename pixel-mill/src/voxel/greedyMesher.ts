import { CHUNK } from "../config";
import { CUT, EMPTY, type VoxelGrid } from "./VoxelGrid";

export interface MeshArrays {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  cut: Float32Array; // 1 for faces of machined voxels (depth-tinted in the shader)
  indices: Uint32Array;
}

/** Linear RGB per voxel material value (index = voxel value). */
export type MaterialColors = [number, number, number][];

/**
 * Greedy-meshes one chunk. For each axis and facing it builds a 2D mask of
 * visible faces (solid voxel owned by this chunk, empty neighbour — which may
 * live in the next chunk) and merges equal-material runs into quads.
 * Positions are in voxel units relative to the grid origin.
 */
export function meshChunk(grid: VoxelGrid, chunkId: number, colors: MaterialColors): MeshArrays | null {
  const [cx, cy, cz] = grid.chunkCoords(chunkId);
  const origin = [cx * CHUNK, cy * CHUNK, cz * CHUNK];
  const size = [
    Math.min(CHUNK, grid.dims.x - origin[0]),
    Math.min(CHUNK, grid.dims.y - origin[1]),
    Math.min(CHUNK, grid.dims.z - origin[2]),
  ];

  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const cut: number[] = [];
  const idx: number[] = [];

  const p = [0, 0, 0];
  const mask = new Uint8Array(CHUNK * CHUNK);

  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3;
    const v = (d + 2) % 3;
    const su = size[u];
    const sv = size[v];

    for (let dir = 1; dir >= -1; dir -= 2) {
      for (let s = 0; s < size[d]; s++) {
        // Build the face mask for this slice.
        let any = false;
        for (let b = 0; b < sv; b++) {
          for (let a = 0; a < su; a++) {
            p[d] = origin[d] + s;
            p[u] = origin[u] + a;
            p[v] = origin[v] + b;
            const val = grid.get(p[0], p[1], p[2]);
            let m = 0;
            if (val !== EMPTY) {
              p[d] += dir;
              if (grid.get(p[0], p[1], p[2]) === EMPTY) m = val;
            }
            mask[a + b * su] = m;
            if (m) any = true;
          }
        }
        if (!any) continue;

        const plane = origin[d] + s + (dir > 0 ? 1 : 0);

        // Greedy merge.
        for (let b = 0; b < sv; b++) {
          for (let a = 0; a < su; ) {
            const m = mask[a + b * su];
            if (!m) {
              a++;
              continue;
            }
            let w = 1;
            while (a + w < su && mask[a + w + b * su] === m) w++;
            let h = 1;
            grow: while (b + h < sv) {
              for (let k = 0; k < w; k++) if (mask[a + k + (b + h) * su] !== m) break grow;
              h++;
            }
            for (let hh = 0; hh < h; hh++) for (let k = 0; k < w; k++) mask[a + k + (b + hh) * su] = 0;

            emitQuad(pos, nor, col, idx, d, u, v, plane, origin[u] + a, origin[v] + b, w, h, dir, colors[m]);
            const flag = m === CUT ? 1 : 0;
            cut.push(flag, flag, flag, flag);
            a += w;
          }
        }
      }
    }
  }

  if (idx.length === 0) return null;
  return {
    positions: new Float32Array(pos),
    normals: new Float32Array(nor),
    colors: new Float32Array(col),
    cut: new Float32Array(cut),
    indices: new Uint32Array(idx),
  };
}

function emitQuad(
  pos: number[], nor: number[], col: number[], idx: number[],
  d: number, u: number, v: number, plane: number,
  a: number, b: number, w: number, h: number, dir: number,
  rgb: [number, number, number],
) {
  const base = pos.length / 3;
  const corner = (du: number, dv: number) => {
    const q = [0, 0, 0];
    q[d] = plane;
    q[u] = a + du;
    q[v] = b + dv;
    pos.push(q[0], q[1], q[2]);
    const n = [0, 0, 0];
    n[d] = dir;
    nor.push(n[0], n[1], n[2]);
    col.push(rgb[0], rgb[1], rgb[2]);
  };
  // e_u x e_v = e_d for cyclic (d,u,v), so this order is CCW seen from +d.
  if (dir > 0) {
    corner(0, 0); corner(w, 0); corner(w, h); corner(0, h);
  } else {
    corner(0, 0); corner(0, h); corner(w, h); corner(w, 0);
  }
  idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}
