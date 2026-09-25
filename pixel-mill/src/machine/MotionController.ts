import * as THREE from "three";
import { MACHINE, type ToolSpec } from "../config";
import { carveSweep, type CarveResult } from "../tools/kernels";
import type { VoxelGrid } from "../voxel/VoxelGrid";
import { floorAt, type Layout } from "./layout";

export interface MotionInput {
  tool: ToolSpec;
  diameter: number;
  depth: number; // mm below stock top (already clamped by caller)
  feed: number; // mm/min
  plungeMode: boolean;
}

export interface MotionResult {
  carve: CarveResult | null;
  collision: string | null;
  moving: boolean;
  inMaterial: boolean;
  strokeEnded: boolean; // a stroke that removed material was committed to undo
  lagMm: number; // straight-line distance from the tool to the cursor target
}

const MAX_QUEUE = 6000;
const MIN_SPACING = 0.2; // mm between queued waypoints

function moveToward(cur: number, want: number, maxStep: number) {
  const d = want - cur;
  return Math.abs(d) <= maxStep ? want : cur + Math.sign(d) * maxStep;
}

/**
 * Drives the tool tip along the path the cursor drew, at a feed-limited
 * speed, so the tool visibly lags a fast cursor but still cuts the drawn path
 * (corners included). Handles retract/travel/plunge sequencing, refuses to
 * enter the vise, and sweeps the cutting kernel along the actual motion.
 */
export class MotionController {
  readonly tip = new THREE.Vector3();
  /** Latest cursor target (end of the queue). */
  readonly target = new THREE.Vector3();
  pressed = false;
  /** Stay at retract height until the next press (after tool change, undo, new stock). */
  holdAtSafe = true;
  private queue: number[] = []; // flat x,z pairs
  private head = 0; // index of the next waypoint pair
  private approach = false;
  private plunging = false;
  private prev = new THREE.Vector3();
  private grid!: VoxelGrid;
  private layout!: Layout;
  private pts: number[] = [];

  constructor(grid: VoxelGrid, layout: Layout) {
    this.reset(grid, layout);
  }

  reset(grid: VoxelGrid, layout: Layout) {
    this.grid = grid;
    this.layout = layout;
    this.tip.set(0, layout.safeY, layout.size.z * 0.25);
    this.target.copy(this.tip);
    this.clearQueue();
    this.holdAtSafe = true;
    this.approach = false;
    this.plunging = false;
  }

  private clearQueue() {
    this.queue.length = 0;
    this.head = 0;
  }

  private get queued() {
    return this.queue.length / 2 - this.head;
  }

  private enqueue(x: number, z: number) {
    this.target.set(x, 0, z);
    const n = this.queue.length;
    if (this.queued > 0) {
      const lx = this.queue[n - 2], lz = this.queue[n - 1];
      if (Math.hypot(x - lx, z - lz) < MIN_SPACING) return;
    }
    if (this.head > 512) {
      this.queue.splice(0, this.head * 2);
      this.head = 0;
    }
    if (this.queued > MAX_QUEUE) {
      // Cursor is far ahead: thin the backlog rather than grow without bound.
      const keep: number[] = [];
      for (let i = this.head * 2; i < this.queue.length; i += 4) keep.push(this.queue[i], this.queue[i + 1]);
      this.queue = keep;
      this.head = 0;
    }
    this.queue.push(x, z);
  }

  clampTarget(x: number, z: number): [number, number] {
    const t = this.layout.travel;
    return [THREE.MathUtils.clamp(x, t.x0, t.x1), THREE.MathUtils.clamp(z, t.z0, t.z1)];
  }

  press(x: number, z: number, toolRadius: number) {
    this.pressed = true;
    this.holdAtSafe = false;
    const [cx, cz] = this.clampTarget(x, z);
    // Starting somewhere else: travel there retracted instead of gouging a path to it.
    const n = this.queue.length;
    const lastX = this.queued > 0 ? this.queue[n - 2] : this.tip.x;
    const lastZ = this.queued > 0 ? this.queue[n - 1] : this.tip.z;
    if (Math.hypot(cx - lastX, cz - lastZ) > toolRadius + 1) {
      this.clearQueue();
      this.approach = true;
    }
    this.enqueue(cx, cz);
  }

  drag(x: number, z: number, tool: ToolSpec) {
    if (!this.pressed || tool.plungeOnly) return;
    const [cx, cz] = this.clampTarget(x, z);
    this.enqueue(cx, cz);
  }

  release() {
    this.pressed = false;
  }

  /** Stop, drop the pending path and lift straight up without cutting. */
  retractNow() {
    this.clearQueue();
    this.tip.y = Math.max(this.tip.y, this.layout.safeY);
    this.target.set(this.tip.x, 0, this.tip.z);
    this.holdAtSafe = true;
    this.approach = false;
    this.plunging = false;
  }

  update(dt: number, inp: MotionInput): MotionResult {
    const L = this.layout;
    const tip = this.tip;
    const R = inp.diameter / 2;
    const depthY = L.top - inp.depth;
    const hasPath = this.queued > 0;

    let wantDown: boolean;
    if (inp.tool.plungeOnly) wantDown = this.pressed;
    else if (inp.plungeMode) wantDown = this.pressed || hasPath; // finish the drawn path before lifting
    else wantDown = !this.holdAtSafe;
    let wantY = wantDown ? depthY : L.safeY;

    // The drill never moves sideways while in the material.
    if (inp.tool.plungeOnly && hasPath && tip.y < L.top + 0.5) {
      const wx = this.queue[this.head * 2], wz = this.queue[this.head * 2 + 1];
      if (Math.hypot(wx - tip.x, wz - tip.z) > 0.05) this.approach = true;
    }

    let allowHorizontal = true;
    if (this.approach) {
      if (hasPath) {
        wantY = Math.max(wantY, L.safeY);
        if (tip.y < L.safeY - 0.01) allowHorizontal = false; // rise first
      } else {
        this.approach = false;
        this.plunging = true;
      }
    }
    if (this.plunging) {
      if (wantY >= tip.y - 0.05) this.plunging = false;
      else allowHorizontal = false;
    }

    let collision: string | null = null;
    const fCur = floorAt(L, tip.x, tip.z, R);
    if (wantY < fCur.y - 1e-3) {
      wantY = fCur.y;
      collision = fCur.by;
    }

    const feedS = inp.feed / 60;
    const inAir = tip.y >= L.top - 1e-3;
    const hSpeed = inAir ? Math.max(MACHINE.rapidSpeed, feedS) : feedS;
    const goingDown = wantY < tip.y;
    const vSpeed = goingDown ? (tip.y > L.top + 0.5 ? MACHINE.rapidSpeed : feedS * MACHINE.plungeFactor) : MACHINE.rapidSpeed;

    this.prev.copy(tip);
    let ny = moveToward(tip.y, wantY, vSpeed * dt);
    // Rapid down to just above the surface, then plunge at feed.
    if (goingDown && tip.y > L.top + 0.5 && ny < L.top + 0.5)
      ny = Math.max(ny, L.top + 0.5 - feedS * MACHINE.plungeFactor * dt);

    // Walk the queued path, collecting the polyline travelled this frame.
    const pts = this.pts;
    pts.length = 0;
    pts.push(tip.x, tip.z);
    let px = tip.x, pz = tip.z;
    if (allowHorizontal) {
      let budget = hSpeed * dt;
      while (budget > 1e-9 && this.queued > 0) {
        const wx = this.queue[this.head * 2], wz = this.queue[this.head * 2 + 1];
        const d = Math.hypot(wx - px, wz - pz);
        const reached = d <= budget;
        const nx = reached ? wx : px + ((wx - px) / d) * budget;
        const nz = reached ? wz : pz + ((wz - pz) / d) * budget;
        const f = floorAt(L, nx, nz, R);
        if (f.y > ny + 1e-3) {
          // Would enter the vise below its top: stop here and drop the rest of the path.
          collision = f.by;
          this.clearQueue();
          this.target.set(px, 0, pz);
          break;
        }
        budget -= reached ? d : budget;
        px = nx;
        pz = nz;
        pts.push(px, pz);
        if (!reached) break;
        this.head++;
        if (this.approach) {
          // Arrived above the start point: plunge there before feeding along the path.
          this.approach = false;
          this.plunging = true;
          break;
        }
      }
    }
    tip.set(px, ny, pz);

    const moved = this.prev.distanceToSquared(tip) > 1e-10;
    let carve: CarveResult | null = null;
    if (moved && Math.min(this.prev.y, tip.y) < L.top) {
      this.grid.beginStroke();
      carve = this.carvePolyline(inp, pts, this.prev.y, ny);
    }

    let strokeEnded = false;
    const settled = !moved && this.queued === 0 && Math.abs(wantY - tip.y) < 1e-3;
    if (this.grid.strokeActive && !this.pressed && settled) strokeEnded = this.grid.endStroke() > 0;

    return {
      carve,
      collision,
      moving: moved,
      inMaterial: tip.y < L.top,
      strokeEnded,
      lagMm: Math.hypot(this.target.x - tip.x, this.target.z - tip.z),
    };
  }

  /** Sweep the kernel along each segment, interpolating height by distance travelled. */
  private carvePolyline(inp: MotionInput, pts: number[], y0: number, y1: number): CarveResult {
    const a = new THREE.Vector3(pts[0], y0, pts[1]);
    const b = new THREE.Vector3();
    if (pts.length === 2) {
      b.set(pts[0], y1, pts[1]);
      return carveSweep(this.grid, this.layout, inp.tool, inp.diameter, a, b);
    }
    let len = 0;
    for (let i = 2; i < pts.length; i += 2) len += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    const total: CarveResult = { removed: 0, x: 0, y: 0, z: 0 };
    let run = 0;
    for (let i = 2; i < pts.length; i += 2) {
      run += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
      b.set(pts[i], y0 + (y1 - y0) * (len > 0 ? run / len : 1), pts[i + 1]);
      const r = carveSweep(this.grid, this.layout, inp.tool, inp.diameter, a, b);
      if (r.removed) {
        total.x += r.x * r.removed;
        total.y += r.y * r.removed;
        total.z += r.z * r.removed;
        total.removed += r.removed;
      }
      a.copy(b);
    }
    if (total.removed) {
      total.x /= total.removed;
      total.y /= total.removed;
      total.z /= total.removed;
    }
    return total;
  }
}
