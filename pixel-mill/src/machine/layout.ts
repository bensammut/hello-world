import * as THREE from "three";
import { MACHINE, TOOLS, VOXEL_MM } from "../config";
import type { Dims } from "../voxel/VoxelGrid";

export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface Obstacle extends Rect {
  top: number;
  name: string;
}

/** World placement of the stock, vise, rack and travel limits, derived from the stock size. */
export interface Layout {
  dims: Dims;
  size: THREE.Vector3; // mm
  min: THREE.Vector3; // world position of voxel (0,0,0) corner
  top: number;
  bottom: number;
  safeY: number;
  jawWidth: number;
  jawTop: number;
  obstacles: Obstacle[];
  viseBase: Obstacle;
  travel: Rect;
  rackZ: number;
  /** Parked tool-assembly top position for each magazine slot (index = slot - 1). */
  rackSlots: THREE.Vector3[];
}

export function computeLayout(dims: Dims): Layout {
  const size = new THREE.Vector3(dims.x * VOXEL_MM, dims.y * VOXEL_MM, dims.z * VOXEL_MM);
  const bottom = MACHINE.viseFloorY;
  const top = bottom + size.y;
  const min = new THREE.Vector3(-size.x / 2, bottom, -size.z / 2);
  const T = MACHINE.jawThickness;
  const jawWidth = Math.max(12, size.x * 0.72);
  const jawTop = bottom + Math.min(MACHINE.jawHeight, size.y * 0.4);
  const hz = size.z / 2;
  const hw = jawWidth / 2;

  const obstacles: Obstacle[] = [
    { name: "VISE", x0: -hw, x1: hw, z0: -hz - T, z1: -hz, top: jawTop },
    { name: "VISE", x0: -hw, x1: hw, z0: hz, z1: hz + T, top: jawTop },
  ];
  const viseBase: Obstacle = {
    name: "VISE", x0: -hw - 3, x1: hw + 3, z0: -hz - T - 6, z1: hz + T + 26, top: bottom,
  };

  const rackZ = -hz - T - MACHINE.rack.gapFromStock;
  const rackSlots = TOOLS.map(
    (_, i) =>
      new THREE.Vector3(
        (i - (TOOLS.length - 1) / 2) * MACHINE.rack.slotSpacing,
        MACHINE.rack.shelfY + MACHINE.rack.ringHeight,
        rackZ,
      ),
  );

  const m = MACHINE.travelMargin;
  return {
    dims: { ...dims },
    size,
    min,
    top,
    bottom,
    safeY: top + MACHINE.safeClearance,
    jawWidth,
    jawTop,
    obstacles,
    viseBase,
    travel: { x0: -size.x / 2 - m, x1: size.x / 2 + m, z0: -hz - m, z1: hz + m },
    rackZ,
    rackSlots,
  };
}

/** Does a circle of radius r at (x,z) overlap the rectangle? */
export function circleHitsRect(x: number, z: number, r: number, rect: Rect) {
  const dx = Math.max(rect.x0 - x, 0, x - rect.x1);
  const dz = Math.max(rect.z0 - z, 0, z - rect.z1);
  return dx * dx + dz * dz < r * r;
}

/** Lowest allowed tool-tip height at (x,z) for a tool of radius r, plus what sets it. */
export function floorAt(layout: Layout, x: number, z: number, r: number): { y: number; by: string | null } {
  let y = layout.bottom;
  let by: string | null = null;
  for (const o of layout.obstacles) {
    if (o.top > y && circleHitsRect(x, z, r, o)) {
      y = o.top;
      by = o.name;
    }
  }
  return { y, by };
}
