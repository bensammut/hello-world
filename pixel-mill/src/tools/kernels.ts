import type * as THREE from "three";
import { VOXEL_MM, type ToolSpec } from "../config";
import type { Layout } from "../machine/layout";
import type { VoxelGrid } from "../voxel/VoxelGrid";

const DEG = Math.PI / 180;

/**
 * Radius (mm) of the tool's cutting envelope at height h (mm) above its tip.
 * Every tool is a solid of revolution, so this profile fully defines its kernel.
 */
export function profileRadius(tool: ToolSpec, diameter: number, h: number): number {
  const R = diameter / 2;
  if (h < 0) return -1;
  switch (tool.id) {
    case "flat":
    case "face":
      return R;
    case "ball":
      return h >= R ? R : Math.sqrt(Math.max(0, R * R - (R - h) * (R - h)));
    case "vbit":
    case "drill":
      return Math.min(R, h * Math.tan(((tool.coneDeg ?? 90) / 2) * DEG));
    case "engrave":
      return Math.min(R, 0.08 + h * Math.tan(((tool.coneDeg ?? 30) / 2) * DEG));
  }
}

/** Width of the cut at the stock surface for a given depth (used by the HUD). */
export function cutWidthAt(tool: ToolSpec, diameter: number, depth: number) {
  return 2 * Math.max(0, profileRadius(tool, diameter, depth));
}

// Slight dilation so sub-voxel tools (engraver tip, V-bit point) still leave a visible line.
const TOLERANCE = 0.3; // voxels

export interface CarveResult {
  removed: number;
  /** Average world position of removed voxels (for chip spawning). */
  x: number;
  y: number;
  z: number;
}

/**
 * Sweeps the tool from tip position a to b (world mm) and removes every voxel
 * inside the swept envelope. Horizontal motion is handled exactly with a
 * point-to-segment distance test (no gaps however fast the tool moves);
 * vertical motion is sub-stepped in half-voxel increments.
 */
export function carveSweep(
  grid: VoxelGrid,
  layout: Layout,
  tool: ToolSpec,
  diameter: number,
  a: THREE.Vector3,
  b: THREE.Vector3,
): CarveResult {
  const res: CarveResult = { removed: 0, x: 0, y: 0, z: 0 };
  const inv = 1 / VOXEL_MM;
  // Grid-space coordinates.
  const ax = (a.x - layout.min.x) * inv, ay = (a.y - layout.min.y) * inv, az = (a.z - layout.min.z) * inv;
  const bx = (b.x - layout.min.x) * inv, by = (b.y - layout.min.y) * inv, bz = (b.z - layout.min.z) * inv;
  const { x: nx, y: ny, z: nz } = grid.dims;

  if (Math.min(ay, by) >= ny) return res; // entirely above the stock

  const Rv = (diameter / 2) * inv + TOLERANCE;
  const steps = Math.max(1, Math.ceil(Math.abs(by - ay) / 0.5));

  // Per-layer radius cache (profile depends only on height above tip).
  const rLayer = new Float32Array(ny);

  for (let s = 0; s < steps; s++) {
    const t0 = s / steps, t1 = (s + 1) / steps;
    const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0, y0 = ay + (by - ay) * t0;
    const x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1, y1 = ay + (by - ay) * t1;
    const tipY = Math.min(y0, y1);

    const minX = Math.max(0, Math.floor(Math.min(x0, x1) - Rv));
    const maxX = Math.min(nx - 1, Math.ceil(Math.max(x0, x1) + Rv));
    const minZ = Math.max(0, Math.floor(Math.min(z0, z1) - Rv));
    const maxZ = Math.min(nz - 1, Math.ceil(Math.max(z0, z1) + Rv));
    const minY = Math.max(0, Math.floor(tipY));
    if (minX > maxX || minZ > maxZ || minY >= ny) continue;

    for (let y = minY; y < ny; y++) {
      const h = (y + 0.5 - tipY) * VOXEL_MM;
      const r = profileRadius(tool, diameter, h);
      rLayer[y] = r < 0 ? -1 : r * inv + TOLERANCE;
    }

    const sx = x1 - x0, sz = z1 - z0;
    const len2 = sx * sx + sz * sz;

    for (let y = minY; y < ny; y++) {
      const r = rLayer[y];
      if (r <= 0) continue;
      const r2 = r * r;
      for (let z = minZ; z <= maxZ; z++) {
        const pz = z + 0.5;
        const rowBase = grid.dims.x * (z + nz * y);
        for (let x = minX; x <= maxX; x++) {
          if (grid.data[rowBase + x] === 0) continue;
          const px = x + 0.5;
          let t = len2 > 0 ? ((px - x0) * sx + (pz - z0) * sz) / len2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const dx = px - (x0 + sx * t);
          const dz = pz - (z0 + sz * t);
          if (dx * dx + dz * dz <= r2) {
            grid.carve(x, y, z);
            res.removed++;
            res.x += px;
            res.y += y + 0.5;
            res.z += pz;
          }
        }
      }
    }
  }

  if (res.removed > 0) {
    res.x = (res.x / res.removed) * VOXEL_MM + layout.min.x;
    res.y = (res.y / res.removed) * VOXEL_MM + layout.min.y;
    res.z = (res.z / res.removed) * VOXEL_MM + layout.min.z;
  }
  return res;
}
