import { VOXEL_MM } from "../config";
import { EMPTY, type VoxelGrid } from "../voxel/VoxelGrid";

// Face definitions: neighbour offset, outward normal, and 4 corners (unit cube, CCW from outside).
const FACES: { d: [number, number, number]; c: [number, number, number][] }[] = [
  { d: [1, 0, 0], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { d: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { d: [0, 1, 0], c: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
  { d: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { d: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { d: [0, 0, -1], c: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
];

/**
 * Binary STL of the part surface, one quad per exposed voxel face (no greedy
 * merging, which would introduce T-junctions and break watertightness).
 * Converted from the app's Y-up frame to the usual Z-up, in millimetres.
 */
export function exportStl(grid: VoxelGrid): Blob {
  const { x: nx, y: ny, z: nz } = grid.dims;
  let faces = 0;
  for (let y = 0; y < ny; y++)
    for (let z = 0; z < nz; z++)
      for (let x = 0; x < nx; x++) {
        if (grid.data[grid.index(x, y, z)] === EMPTY) continue;
        for (const f of FACES) if (grid.get(x + f.d[0], y + f.d[1], z + f.d[2]) === EMPTY) faces++;
      }

  const tris = faces * 2;
  const buf = new ArrayBuffer(84 + tris * 50);
  const view = new DataView(buf);
  const header = "PIXEL MILL voxel part export (mm, Z up)";
  for (let i = 0; i < 80; i++) view.setUint8(i, i < header.length ? header.charCodeAt(i) : 32);
  view.setUint32(80, tris, true);

  let o = 84;
  const depth = nz * VOXEL_MM;
  // (x, y, z) Y-up  ->  (x, depth - z, y) Z-up: a proper rotation, so winding is preserved.
  const put = (px: number, py: number, pz: number) => {
    view.setFloat32(o, px * VOXEL_MM, true);
    view.setFloat32(o + 4, depth - pz * VOXEL_MM, true);
    view.setFloat32(o + 8, py * VOXEL_MM, true);
    o += 12;
  };
  const tri = (n: [number, number, number], x: number, y: number, z: number, a: number[], b: number[], c: number[]) => {
    view.setFloat32(o, n[0], true);
    view.setFloat32(o + 4, -n[2], true);
    view.setFloat32(o + 8, n[1], true);
    o += 12;
    put(x + a[0], y + a[1], z + a[2]);
    put(x + b[0], y + b[1], z + b[2]);
    put(x + c[0], y + c[1], z + c[2]);
    view.setUint16(o, 0, true);
    o += 2;
  };

  for (let y = 0; y < ny; y++)
    for (let z = 0; z < nz; z++)
      for (let x = 0; x < nx; x++) {
        if (grid.data[grid.index(x, y, z)] === EMPTY) continue;
        for (const f of FACES) {
          if (grid.get(x + f.d[0], y + f.d[1], z + f.d[2]) !== EMPTY) continue;
          const [c0, c1, c2, c3] = f.c;
          tri(f.d, x, y, z, c0, c1, c2);
          tri(f.d, x, y, z, c0, c2, c3);
        }
      }
  return new Blob([buf], { type: "model/stl" });
}
