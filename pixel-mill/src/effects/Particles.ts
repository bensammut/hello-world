import * as THREE from "three";
import { CHIP_PILE_MAX, COLORS, FLYING_CHIPS_MAX, MIST_MAX, VOXEL_MM } from "../config";
import type { Layout } from "../machine/layout";
import type { VoxelGrid } from "../voxel/VoxelGrid";

const vert = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  varying vec3 vColor;
  void main() {
    vColor = aColor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize; // render target pixels, so 1.0 = exactly one art pixel
  }
`;
const frag = /* glsl */ `
  varying vec3 vColor;
  void main() { gl_FragColor = vec4(vColor, 1.0); }
`;

const GRAVITY = 1700; // mm/s^2 — a bit floaty for readability
const chipColors = COLORS.chip.map((c) => new THREE.Color(c));
const mistColors = COLORS.mist.map((c) => new THREE.Color(c));

/** A fixed-capacity point cloud with swap-remove semantics. */
class PointPool {
  readonly points: THREE.Points;
  readonly pos: Float32Array;
  readonly vel: Float32Array;
  readonly col: Float32Array;
  readonly size: Float32Array;
  readonly life: Float32Array;
  count = 0;
  readonly capacity: number;

  constructor(capacity: number, pointSize: number) {
    this.capacity = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity).fill(pointSize);
    this.life = new Float32Array(capacity);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aColor", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.points = new THREE.Points(geo, new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag }));
    this.points.frustumCulled = false;
  }

  add(x: number, y: number, z: number, vx: number, vy: number, vz: number, c: THREE.Color, life: number): number {
    if (this.count >= this.capacity) return -1;
    const i = this.count++;
    this.set(i, x, y, z, vx, vy, vz, c, life);
    return i;
  }

  set(i: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, c: THREE.Color, life: number) {
    const k = i * 3;
    this.pos[k] = x; this.pos[k + 1] = y; this.pos[k + 2] = z;
    this.vel[k] = vx; this.vel[k + 1] = vy; this.vel[k + 2] = vz;
    this.col[k] = c.r; this.col[k + 1] = c.g; this.col[k + 2] = c.b;
    this.life[i] = life;
  }

  remove(i: number) {
    const last = --this.count;
    if (i === last) return;
    this.pos.copyWithin(i * 3, last * 3, last * 3 + 3);
    this.vel.copyWithin(i * 3, last * 3, last * 3 + 3);
    this.col.copyWithin(i * 3, last * 3, last * 3 + 3);
    this.size[i] = this.size[last];
    this.life[i] = this.life[last];
  }

  commit() {
    const g = this.points.geometry;
    g.setDrawRange(0, this.count);
    this.points.visible = this.count > 0; // an empty draw call makes WebGL warn every frame
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** Chips flying off the cutter, chips piled on surfaces, and coolant mist. */
export class Particles {
  readonly group = new THREE.Group();
  private flying = new PointPool(FLYING_CHIPS_MAX, 1);
  private pile = new PointPool(CHIP_PILE_MAX, 1);
  private blown = new PointPool(CHIP_PILE_MAX, 1);
  private mist = new PointPool(MIST_MAX, 1);
  private pileCursor = 0;
  private checkCursor = 0;
  private tmpColor = new THREE.Color();
  private grid: VoxelGrid;
  private layout: Layout;

  constructor(grid: VoxelGrid, layout: Layout) {
    this.grid = grid;
    this.layout = layout;
    this.group.add(this.flying.points, this.pile.points, this.blown.points, this.mist.points);
  }

  setWorld(grid: VoxelGrid, layout: Layout) {
    this.grid = grid;
    this.layout = layout;
    this.flying.count = 0;
    this.pile.count = 0;
    this.blown.count = 0;
    this.mist.count = 0;
  }

  get pileCount() {
    return this.pile.count;
  }

  spawnChips(tipX: number, tipZ: number, cutY: number, radius: number, count: number, rpmFactor: number) {
    for (let n = 0; n < count; n++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.max(0.3, radius);
      const s = (50 + Math.random() * 110) * (0.4 + 0.6 * rpmFactor);
      const ca = Math.cos(a), sa = Math.sin(a);
      // Clockwise spindle seen from above: tangential velocity + some outward throw.
      const vx = sa * s + ca * s * 0.45;
      const vz = -ca * s + sa * s * 0.45;
      const vy = 50 + Math.random() * 160;
      const c = chipColors[(Math.random() * chipColors.length) | 0];
      this.flying.add(tipX + ca * r, cutY + Math.random() * 0.8, tipZ + sa * r, vx, vy, vz, c, 3);
      if (Math.random() < 0.25) this.flying.size[this.flying.count - 1] = 2;
    }
  }

  spawnMist(from: THREE.Vector3, to: THREE.Vector3, count: number) {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    for (let n = 0; n < count; n++) {
      const s = 160 + Math.random() * 140;
      const j = 0.35;
      const c = mistColors[(Math.random() * mistColors.length) | 0];
      this.mist.add(
        from.x, from.y, from.z,
        (dx / len + (Math.random() - 0.5) * j) * s,
        (dy / len + (Math.random() - 0.5) * j) * s,
        (dz / len + (Math.random() - 0.5) * j) * s,
        c, 0.18 + Math.random() * 0.3,
      );
    }
  }

  blowOff() {
    const p = this.pile;
    for (let i = 0; i < p.count; i++) {
      const k = i * 3;
      const x = p.pos[k], z = p.pos[k + 2];
      const d = Math.hypot(x, z) || 1;
      const s = 250 + Math.random() * 300;
      this.tmpColor.setRGB(p.col[k], p.col[k + 1], p.col[k + 2]);
      this.blown.add(x, p.pos[k + 1], z, (x / d) * s, 80 + Math.random() * 200, (z / d) * s, this.tmpColor, 0.6 + Math.random() * 0.8);
    }
    p.count = 0;
    this.pileCursor = 0;
  }

  /** Surface height a chip would rest on at (x,z) when falling through y, or null if still airborne. */
  private landing(x: number, y: number, z: number): number | null {
    const L = this.layout;
    const g = this.grid;
    const gx = Math.floor((x - L.min.x) / VOXEL_MM);
    const gz = Math.floor((z - L.min.z) / VOXEL_MM);
    let gy = Math.floor((y - L.min.y) / VOXEL_MM);
    if (gy >= 0 && gy < g.dims.y && g.get(gx, gy, gz) !== 0) {
      while (gy < g.dims.y && g.get(gx, gy, gz) !== 0) gy++;
      return L.min.y + gy * VOXEL_MM;
    }
    for (const o of L.obstacles) if (y < o.top && x > o.x0 && x < o.x1 && z > o.z0 && z < o.z1) return o.top;
    const b = L.viseBase;
    if (y < b.top && x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1) return b.top;
    if (y < 0.35 && Math.abs(x) < 175 && Math.abs(z) < 150) return 0.35;
    if (y < -18) return -18;
    return null;
  }

  private addToPile(x: number, y: number, z: number, c: THREE.Color, size: number) {
    let i = this.pile.add(x, y, z, 0, 0, 0, c, 0);
    if (i < 0) {
      // Pile is full: overwrite the oldest chip.
      i = this.pileCursor;
      this.pileCursor = (this.pileCursor + 1) % this.pile.capacity;
      this.pile.set(i, x, y, z, 0, 0, 0, c, 0);
    }
    this.pile.size[i] = size;
  }

  update(dt: number) {
    // Flying chips.
    const f = this.flying;
    for (let i = f.count - 1; i >= 0; i--) {
      const k = i * 3;
      f.life[i] -= dt;
      f.vel[k + 1] -= GRAVITY * dt;
      const drag = Math.exp(-dt * 1.2);
      f.vel[k] *= drag;
      f.vel[k + 2] *= drag;
      const nx = f.pos[k] + f.vel[k] * dt;
      const ny = f.pos[k + 1] + f.vel[k + 1] * dt;
      const nz = f.pos[k + 2] + f.vel[k + 2] * dt;
      const land = f.vel[k + 1] < 0 ? this.landing(nx, ny, nz) : null;
      if (land !== null) {
        if (Math.random() < 0.3 && f.vel[k + 1] < -120) {
          // Small bounce keeps the pile from looking like a single sheet.
          f.pos[k] = nx; f.pos[k + 1] = land + 0.01; f.pos[k + 2] = nz;
          f.vel[k + 1] *= -0.25;
          f.vel[k] *= 0.4;
          f.vel[k + 2] *= 0.4;
          continue;
        }
        this.tmpColor.setRGB(f.col[k], f.col[k + 1], f.col[k + 2]);
        this.addToPile(nx, land + 0.05, nz, this.tmpColor, f.size[i]);
        f.remove(i);
        continue;
      }
      if (f.life[i] <= 0) {
        f.remove(i);
        continue;
      }
      f.pos[k] = nx; f.pos[k + 1] = ny; f.pos[k + 2] = nz;
    }

    // Piled chips resting on stock that has since been machined away fall again.
    const p = this.pile;
    const checks = Math.min(p.count, 400);
    for (let n = 0; n < checks; n++) {
      if (this.checkCursor >= p.count) this.checkCursor = 0;
      const i = this.checkCursor++;
      const k = i * 3;
      const x = p.pos[k], y = p.pos[k + 1], z = p.pos[k + 2];
      if (y <= this.layout.bottom + 0.1) continue;
      if (this.landing(x, y - 0.3, z) === null) {
        this.tmpColor.setRGB(p.col[k], p.col[k + 1], p.col[k + 2]);
        if (f.add(x, y, z, 0, 0, 0, this.tmpColor, 3) >= 0) {
          f.size[f.count - 1] = p.size[i];
          p.remove(i);
        }
      }
    }

    // Blown-off chips: no collisions, just fly away and vanish.
    const b = this.blown;
    for (let i = b.count - 1; i >= 0; i--) {
      const k = i * 3;
      b.life[i] -= dt;
      if (b.life[i] <= 0) {
        b.remove(i);
        continue;
      }
      b.vel[k + 1] -= GRAVITY * 0.3 * dt;
      b.pos[k] += b.vel[k] * dt;
      b.pos[k + 1] += b.vel[k + 1] * dt;
      b.pos[k + 2] += b.vel[k + 2] * dt;
    }

    // Mist.
    const m = this.mist;
    for (let i = m.count - 1; i >= 0; i--) {
      const k = i * 3;
      m.life[i] -= dt;
      if (m.life[i] <= 0) {
        m.remove(i);
        continue;
      }
      const drag = Math.exp(-dt * 5);
      m.vel[k] *= drag;
      m.vel[k + 1] = m.vel[k + 1] * drag - 60 * dt;
      m.vel[k + 2] *= drag;
      m.pos[k] += m.vel[k] * dt;
      m.pos[k + 1] += m.vel[k + 1] * dt;
      m.pos[k + 2] += m.vel[k + 2] * dt;
    }

    f.commit();
    p.commit();
    b.commit();
    m.commit();
  }
}
