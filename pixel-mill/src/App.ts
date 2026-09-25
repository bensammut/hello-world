import * as THREE from "three";
import {
  COLORS, DEFAULT_GRID, LIMITS, MAX_GRID, MESH_BUDGET_MS, MIN_GRID, TOOLS, TOOL_BY_ID, VOXEL_MM,
  type CameraPresetName, type ToolId,
} from "./config";
import { SoundEngine } from "./audio/SoundEngine";
import { Particles } from "./effects/Particles";
import { InputController } from "./input/InputController";
import { downloadBlob, loadProject, saveProject } from "./io/projectFile";
import { exportStl } from "./io/stlExport";
import { computeLayout, type Layout } from "./machine/layout";
import { MachineModel, type LightState } from "./machine/MachineModel";
import { MotionController } from "./machine/MotionController";
import { ToolChanger } from "./machine/ToolChanger";
import { CameraRig } from "./render/CameraRig";
import { GhostCursor } from "./render/GhostCursor";
import { PixelRenderer } from "./render/PixelRenderer";
import { Store, type MachineStatus } from "./state/store";
import { cutWidthAt, profileRadius } from "./tools/kernels";
import { buildToolAssembly, disposeGroup } from "./tools/toolMeshes";
import { UI, type UIActions } from "./ui/UI";
import { ChunkMeshes } from "./voxel/ChunkMeshes";
import { VoxelGrid, type Dims } from "./voxel/VoxelGrid";

const VOXEL_VOLUME = VOXEL_MM ** 3;

export class App {
  readonly store = new Store();
  private grid: VoxelGrid;
  private layout: Layout;
  private scene = new THREE.Scene();
  private pixel: PixelRenderer;
  private rig = new CameraRig();
  private chunks: ChunkMeshes;
  private machine = new MachineModel();
  private motion: MotionController;
  private changer = new ToolChanger();
  private particles: Particles;
  private ghost = new GhostCursor();
  private sound = new SoundEngine();
  private ui: UI;
  private input: InputController;
  private jogging = false;
  private canvas: HTMLCanvasElement;

  private assemblies = {} as Record<ToolId, THREE.Group>;
  private mounted: ToolId;
  private pendingTool: ToolId | null = null;
  private rpmActual = 0;
  private hover = { x: 0, z: 0, on: false };
  private alarmT = 0;
  private warnCooldown = 0;
  private cutHold = 0;
  private cutRate = 0;
  private fps = 60;
  private uiTimer = 0;
  private uiDirty = false;
  private last = performance.now();
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();

  constructor(root: HTMLElement) {
    this.canvas = root.querySelector("#view") as HTMLCanvasElement;
    this.grid = new VoxelGrid(DEFAULT_GRID);
    this.layout = computeLayout(this.grid.dims);
    this.pixel = new PixelRenderer(this.canvas);
    this.chunks = new ChunkMeshes(this.grid);
    this.motion = new MotionController(this.grid, this.layout);
    this.particles = new Particles(this.grid, this.layout);
    this.mounted = this.store.state.toolId;

    this.buildScene();
    for (const t of TOOLS) {
      this.assemblies[t.id] = buildToolAssembly(t, t.diameters[this.store.state.diameterIndex[t.id]]);
      if (t.id === this.mounted) this.mount(t.id);
      else this.park(t.id);
    }
    this.applyLayout();
    this.chunks.flush();
    this.rig.preset("iso", true);

    this.ui = new UI(root.querySelector("#ui") as HTMLElement, this.store, this.uiActions());
    this.input = new InputController(this.canvas, this.inputActions());

    const resize = () => {
      // DPR can change without a size change (browser zoom, moving screens).
      const dpr = Math.min(window.devicePixelRatio, 2);
      if (this.pixel.renderer.getPixelRatio() !== dpr) this.pixel.renderer.setPixelRatio(dpr);
      this.pixel.resize(this.canvas.clientWidth, this.canvas.clientHeight, this.rig.camera);
    };
    new ResizeObserver(resize).observe(this.canvas);
    window.addEventListener("resize", resize);
    resize();
    requestAnimationFrame(this.tick);
  }

  private buildScene() {
    const s = this.scene;
    s.background = new THREE.Color(COLORS.background);
    s.add(new THREE.HemisphereLight("#ccd4e2", "#1f2430", 1.25));
    const key = new THREE.DirectionalLight("#ffffff", 2.7);
    key.position.set(-90, 300, 130);
    const rim = new THREE.DirectionalLight("#7fdcff", 0.7);
    rim.position.set(220, 90, -160);
    s.add(key, rim);
    s.add(this.machine.root, this.chunks.group, this.particles.group, this.ghost.group);
  }

  // ---------------------------------------------------------------------------
  // Tools
  // ---------------------------------------------------------------------------

  private get spec() {
    return TOOL_BY_ID[this.mounted];
  }

  private get diameter() {
    return this.spec.diameters[this.store.state.diameterIndex[this.mounted]];
  }

  private maxDepth() {
    return Math.min(TOOL_BY_ID[this.store.state.toolId].maxDepth, this.layout.size.y);
  }

  private mount(id: ToolId) {
    const a = this.assemblies[id];
    a.name = "tool-mounted";
    a.position.set(0, 0, 0);
    a.rotation.set(0, 0, 0);
    this.machine.spinner.add(a);
    this.mounted = id;
    this.machine.applyXrayToTool();
  }

  private park(id: ToolId) {
    const a = this.assemblies[id];
    a.traverse((o) => o.name === "holder" && (o.visible = true));
    a.name = "tool-parked";
    a.position.copy(this.layout.rackSlots[TOOL_BY_ID[id].slot - 1]);
    a.rotation.set(0, 0, 0);
    this.machine.rack.add(a);
  }

  private selectTool(id: ToolId) {
    if (this.changer.active) {
      this.pendingTool = id;
      return;
    }
    if (id === this.mounted) return;
    this.startToolChange(id);
  }

  private startToolChange(id: ToolId) {
    const oldSpec = this.spec;
    const newSpec = TOOL_BY_ID[id];
    const tip = this.motion.tip;
    this.motion.release();
    this.commitStroke();
    const L = this.layout;
    const safeY = Math.max(L.rackSlots[0].y, L.safeY) + Math.max(oldSpec.stickout, newSpec.stickout) + 4;
    const head = tip.clone().setY(tip.y + oldSpec.stickout);
    const ret = new THREE.Vector3(tip.x, L.safeY + newSpec.stickout, tip.z);
    this.store.set({ status: "TOOL CHANGE" });
    this.changer.start({
      head,
      oldSlot: L.rackSlots[oldSpec.slot - 1].clone(),
      newSlot: L.rackSlots[newSpec.slot - 1].clone(),
      returnHead: ret,
      safeY,
      onRelease: () => this.park(this.mounted),
      onGrab: () => {
        this.mount(id);
        const s = this.store.state;
        this.store.set({ toolId: id, rpm: newSpec.rpm, feed: newSpec.feed });
        this.store.set({ depth: Math.min(s.depth, this.maxDepth()) });
      },
      onDone: () => {
        this.motion.tip.set(ret.x, L.safeY, ret.z);
        this.motion.retractNow();
        this.store.state.stats.toolChanges++;
        this.store.set({ status: "READY" });
        const next = this.pendingTool;
        this.pendingTool = null;
        if (next && next !== this.mounted) this.startToolChange(next);
      },
    });
  }

  private stepDiameter(dir: 1 | -1) {
    if (this.changer.active) return;
    const s = this.store.state;
    const t = this.spec;
    const i = THREE.MathUtils.clamp(s.diameterIndex[t.id] + dir, 0, t.diameters.length - 1);
    if (i === s.diameterIndex[t.id] || t.diameters[i] === this.diameter) {
      if (i !== s.diameterIndex[t.id]) this.store.set({ diameterIndex: { ...s.diameterIndex, [t.id]: i } });
      return;
    }
    this.commitStroke();
    const old = this.assemblies[t.id];
    this.machine.spinner.remove(old);
    disposeGroup(old);
    this.assemblies[t.id] = buildToolAssembly(t, t.diameters[i]);
    this.mount(t.id);
    // A different-sized cutter can't sit inside the old cut: lift it out.
    if (this.motion.tip.y < this.layout.top) this.motion.retractNow();
    this.store.set({ diameterIndex: { ...s.diameterIndex, [t.id]: i } });
  }

  // ---------------------------------------------------------------------------
  // Stock / history / files
  // ---------------------------------------------------------------------------

  private commitStroke() {
    if (this.grid.strokeActive && this.grid.endStroke() > 0) this.store.state.stats.strokes++;
    this.syncHistory();
  }

  private syncHistory() {
    this.store.set({ undoDepth: this.grid.undoDepth, redoDepth: this.grid.redoDepth });
  }

  private history(kind: "undo" | "redo") {
    if (this.changer.active) return;
    this.motion.release();
    this.commitStroke();
    const delta = kind === "undo" ? this.grid.undo() : this.grid.redo();
    if (delta === null) {
      this.ui.toast(kind === "undo" ? "NOTHING TO UNDO" : "NOTHING TO REDO", "err");
      return;
    }
    const st = this.store.state.stats;
    st.removedMm3 = Math.max(0, st.removedMm3 + delta * VOXEL_VOLUME);
    this.motion.retractNow();
    this.syncHistory();
  }

  private applyLayout() {
    const L = this.layout;
    this.chunks.group.position.copy(L.min);
    this.chunks.setStockTop(L.top, L.size.y);
    this.machine.setLayout(L);
    for (const t of TOOLS) if (t.id !== this.mounted) this.park(t.id);
    this.rig.setHome(new THREE.Vector3(0, L.top - 6, 0));
  }

  private replaceGrid(grid: VoxelGrid) {
    this.grid = grid;
    this.layout = computeLayout(grid.dims);
    this.chunks.setGrid(grid);
    this.motion.reset(grid, this.layout);
    this.particles.setWorld(grid, this.layout);
    this.applyLayout();
    this.chunks.flush();
    this.rig.preset(this.store.state.camera ?? "iso");
    this.store.set({ depth: Math.min(this.store.state.depth, this.maxDepth()) });
    this.syncHistory();
  }

  private newStock(mm: [number, number, number]) {
    const clampDim = (v: number, lo: number, hi: number) =>
      THREE.MathUtils.clamp(Math.round((Number.isFinite(v) ? v : 0) / VOXEL_MM), lo, hi);
    const dims: Dims = {
      x: clampDim(mm[0], MIN_GRID.x, MAX_GRID.x),
      y: clampDim(mm[1], MIN_GRID.y, MAX_GRID.y),
      z: clampDim(mm[2], MIN_GRID.z, MAX_GRID.z),
    };
    this.replaceGrid(new VoxelGrid(dims));
    this.store.state.stats = { removedMm3: 0, cutTime: 0, toolChanges: 0, strokes: 0 };
    this.store.emit();
    const s = this.layout.size;
    this.ui.toast(`NEW STOCK ${s.x}×${s.z}×${s.y} MM`);
  }

  private async save() {
    try {
      this.commitStroke();
      const r = await saveProject(this.grid, this.store.state);
      this.ui.toast(`SAVED ${(r.json.length / 1024).toFixed(1)} KB (VOXELS PACKED TO ${(r.ratio * 100).toFixed(1)}%)`);
    } catch (e) {
      this.ui.toast(`SAVE FAILED: ${(e as Error).message}`, "err");
    }
  }

  private async open(file: File) {
    try {
      const p = await loadProject(file);
      if (this.changer.active) throw new Error("wait for tool change");
      this.replaceGrid(p.grid);
      const s = this.store.state;
      const diameterIndex = { ...s.diameterIndex };
      for (const t of TOOLS) {
        const i = Number(p.settings.diameterIndex?.[t.id]);
        if (Number.isInteger(i) && i >= 0 && i < t.diameters.length && i !== diameterIndex[t.id]) {
          diameterIndex[t.id] = i;
          const old = this.assemblies[t.id];
          old.parent?.remove(old);
          disposeGroup(old);
          this.assemblies[t.id] = buildToolAssembly(t, t.diameters[i]);
          if (t.id === this.mounted) this.mount(t.id);
          else this.park(t.id);
        }
      }
      if (p.settings.toolId !== this.mounted) {
        const prev = this.mounted;
        this.machine.spinner.remove(this.assemblies[prev]);
        this.mount(p.settings.toolId);
        this.park(prev);
      }
      this.store.set({
        toolId: p.settings.toolId,
        diameterIndex,
        rpm: THREE.MathUtils.clamp(p.settings.rpm, LIMITS.rpm.min, LIMITS.rpm.max),
        feed: THREE.MathUtils.clamp(p.settings.feed, LIMITS.feed.min, LIMITS.feed.max),
        plungeMode: p.settings.plungeMode,
        stats: p.stats,
      });
      this.store.set({ depth: THREE.MathUtils.clamp(p.settings.depth, 0, this.maxDepth()) });
      this.ui.toast(`LOADED ${file.name.toUpperCase()}`);
    } catch (e) {
      this.ui.toast(`OPEN FAILED: ${(e as Error).message}`, "err");
    }
  }

  private exportStl() {
    this.commitStroke();
    const blob = exportStl(this.grid);
    downloadBlob(blob, "pixel-mill-part.stl");
    this.ui.toast(`STL EXPORTED ${(blob.size / 1024 / 1024).toFixed(2)} MB`);
  }

  // ---------------------------------------------------------------------------
  // Action tables for UI and input
  // ---------------------------------------------------------------------------

  private setDepth(mm: number) {
    const step = LIMITS.depthStep;
    const d = THREE.MathUtils.clamp(Math.round(mm / step) * step, 0, this.maxDepth());
    if (d !== this.store.state.depth) this.store.set({ depth: d });
  }

  private setCamera(name: CameraPresetName) {
    this.rig.preset(name);
    this.store.set({ camera: name });
  }

  private freeCamera() {
    if (this.store.state.camera !== null) this.store.set({ camera: null });
  }

  private toggleHelp(force?: boolean) {
    this.store.set({ helpOpen: force ?? !this.store.state.helpOpen });
  }

  private toggleSound() {
    const on = !this.store.state.soundOn;
    this.sound.setEnabled(on);
    this.store.set({ soundOn: on });
  }

  private togglePlunge() {
    this.store.set({ plungeMode: !this.store.state.plungeMode });
    this.ui.toast(this.store.state.plungeMode ? "PLUNGE MODE: TOOL DROPS WHILE HELD" : "CONTOUR MODE: TOOL STAYS AT DEPTH");
  }

  private blowChips() {
    const n = this.particles.pileCount;
    this.particles.blowOff();
    this.ui.toast(n ? `AIR BLAST: ${n} CHIPS` : "TABLE ALREADY CLEAN");
  }

  private uiActions(): UIActions {
    return {
      selectTool: (id) => this.selectTool(id),
      stepDiameter: (d) => this.stepDiameter(d),
      setDepth: (mm) => this.setDepth(mm),
      setFeed: (v) => this.store.set({ feed: THREE.MathUtils.clamp(v, LIMITS.feed.min, LIMITS.feed.max) }),
      setRpm: (v) => this.store.set({ rpm: THREE.MathUtils.clamp(v, LIMITS.rpm.min, LIMITS.rpm.max) }),
      togglePlunge: () => this.togglePlunge(),
      toggleSound: () => this.toggleSound(),
      undo: () => this.history("undo"),
      redo: () => this.history("redo"),
      newStock: (mm) => this.newStock(mm),
      save: () => void this.save(),
      open: (f) => void this.open(f),
      exportStl: () => this.exportStl(),
      camera: (n) => this.setCamera(n),
      blowChips: () => this.blowChips(),
      toggleHelp: (f) => this.toggleHelp(f),
      maxDepth: () => this.maxDepth(),
      currentStockMm: () => [this.layout.size.x, this.layout.size.y, this.layout.size.z],
    };
  }

  private inputActions() {
    return {
      planeY: () => this.layout.top,
      camera: () => this.rig.camera,
      toNdc: (cssX: number, cssY: number, out: THREE.Vector2) => {
        // The low-res frame is slightly larger than the canvas (integer scale); map through it exactly.
        const dpr = this.pixel.renderer.getPixelRatio();
        const w = (this.pixel.lowW * this.pixel.scale) / dpr;
        const h = (this.pixel.lowH * this.pixel.scale) / dpr;
        return out.set((cssX / w) * 2 - 1, ((this.canvas.clientHeight - cssY) / h) * 2 - 1);
      },
      cutStart: (x: number, z: number) => {
        if (this.changer.active) return;
        this.motion.press(x, z, this.diameter / 2);
      },
      cutMove: (x: number, z: number) => this.motion.drag(x, z, this.spec),
      cutEnd: () => this.motion.release(),
      hover: (x: number, z: number, on: boolean) => {
        this.hover.x = x;
        this.hover.z = z;
        this.hover.on = on;
      },
      orbit: (dx: number, dy: number) => {
        this.rig.orbit(dx, dy);
        this.freeCamera();
      },
      pan: (dx: number, dy: number, h: number) => {
        this.rig.pan(dx, dy, h);
        this.freeCamera();
      },
      zoom: (d: number) => {
        this.rig.zoom(d);
        this.freeCamera();
      },
      nudgeDepth: (steps: number) => this.setDepth(this.store.state.depth + steps * LIMITS.depthStep),
      selectTool: (id: ToolId) => this.selectTool(id),
      stepDiameter: (d: 1 | -1) => this.stepDiameter(d),
      togglePlunge: () => this.togglePlunge(),
      undo: () => this.history("undo"),
      redo: () => this.history("redo"),
      save: () => void this.save(),
      open: () => (this.ui.root.querySelector("#file-input") as HTMLInputElement).click(),
      cameraPreset: (n: CameraPresetName) => this.setCamera(n),
      toggleHelp: (f?: boolean) => this.toggleHelp(f),
      blowChips: () => this.blowChips(),
      toggleSound: () => this.toggleSound(),
      escape: () => {
        this.toggleHelp(false);
        this.ui.closeNewStock();
      },
      keyCutStart: () => {
        if (this.changer.active) return;
        this.motion.press(this.motion.tip.x, this.motion.tip.z, this.diameter / 2);
      },
      keyCutEnd: () => this.motion.release(),
      retract: () => {
        if (this.changer.active) return;
        this.motion.retract();
      },
      blocked: () => this.store.state.helpOpen || this.ui.dialogOpen,
    };
  }

  // ---------------------------------------------------------------------------
  // Frame loop
  // ---------------------------------------------------------------------------

  private tick = (now: number) => {
    requestAnimationFrame(this.tick);
    const dt = Math.min((now - this.last) / 1000, 1 / 20);
    this.last = now;
    if (dt <= 0) return;
    this.fps += (1 / Math.max(dt, 1e-3) - this.fps) * 0.05;
    this.frame(dt, true);
  };

  /** Advance the simulation by fixed steps without waiting for animation frames (tests, hidden tabs). */
  simulate(seconds: number, step = 1 / 60) {
    for (let t = 0; t < seconds; t += step) this.frame(step, false);
    this.pixel.render(this.scene, this.rig.camera);
  }

  private frame(dt: number, render: boolean) {
    const s = this.store.state;
    const L = this.layout;
    const head = this.tmp;
    let removed = 0;
    let moving = false;

    this.updateJog();
    if (this.changer.active) this.changer.update(dt);
    if (this.changer.active) {
      head.copy(this.changer.head);
    } else {
      const res = this.motion.update(dt, {
        tool: this.spec,
        diameter: this.diameter,
        depth: Math.min(s.depth, this.maxDepth()),
        feed: s.feed,
        plungeMode: s.plungeMode,
      });
      moving = res.moving;
      if (res.carve && res.carve.removed > 0) {
        removed = res.carve.removed;
        s.stats.removedMm3 += removed * VOXEL_VOLUME;
        const r = Math.max(0.4, profileRadius(this.spec, this.diameter, Math.max(0, L.top - this.motion.tip.y)));
        const n = Math.min(14, 1 + Math.ceil(removed * 0.025));
        this.particles.spawnChips(this.motion.tip.x, this.motion.tip.z, res.carve.y, r, n, this.rpmActual / 30000);
        this.cutHold = 0.25;
      }
      if (res.collision && this.warnCooldown <= 0) {
        this.ui.flashWarning(`${res.collision} COLLISION!`);
        this.warnCooldown = 0.9;
        this.alarmT = 0.9;
      }
      if (res.strokeEnded) {
        s.stats.strokes++;
        this.syncHistory();
      }
      head.copy(this.motion.tip).setY(this.motion.tip.y + this.spec.stickout);
    }
    this.warnCooldown -= dt;
    this.alarmT -= dt;
    this.cutRate += (removed / dt - this.cutRate) * Math.min(1, dt * 10);
    if (this.cutHold > 0) {
      this.cutHold -= dt;
      s.stats.cutTime += dt;
      this.uiDirty = true;
    }

    // Spindle speed ramps toward the commanded RPM (and to zero during a tool change).
    const rpmTarget = s.rpm * (this.changer.active ? this.changer.spinFactor : 1);
    const ramp = 45000 * dt;
    this.rpmActual += THREE.MathUtils.clamp(rpmTarget - this.rpmActual, -ramp, ramp);

    const status: MachineStatus = this.changer.active
      ? "TOOL CHANGE"
      : this.alarmT > 0
        ? "COLLISION"
        : this.cutHold > 0
          ? "CUTTING"
          : moving
            ? "TRAVEL"
            : "READY";
    if (status !== s.status) {
      s.status = status;
      this.uiDirty = true;
    }

    this.machine.setHead(head);
    this.machine.spin(this.rpmActual, dt);
    const light: LightState = status === "TOOL CHANGE" ? "change" : status === "COLLISION" ? "alarm" : status === "CUTTING" ? "cutting" : "ready";
    this.machine.setLight(light, dt);
    this.machine.root.updateMatrixWorld();

    const tipWorld = this.tmp2.copy(head).setY(head.y - this.spec.stickout);
    if (this.cutHold > 0 && this.rpmActual > 1000) {
      const nozzle = this.machine.nozzleWorld(new THREE.Vector3());
      this.particles.spawnMist(nozzle, tipWorld, 5);
    }

    this.chunks.update(MESH_BUDGET_MS);
    this.particles.update(dt);
    this.updateGhost(s.depth);
    this.rig.update(dt);
    this.machine.setXray(this.rig.polar < 0.42);
    this.sound.update(this.rpmActual, this.cutRate, this.spec.flutes, dt);
    if (render) this.pixel.render(this.scene, this.rig.camera);

    this.uiTimer -= dt;
    if (this.uiTimer <= 0) {
      this.uiTimer = 0.1;
      if (this.uiDirty) {
        this.uiDirty = false;
        this.store.emit();
      }
      const moveSpeed = moving ? (this.motion.tip.y < L.top ? s.feed : 60 * 220) : 0;
      this.ui.updateLive(s, {
        x: tipWorld.x - L.min.x,
        y: L.min.z + L.size.z - tipWorld.z,
        z: tipWorld.y - L.top,
        rpm: this.rpmActual,
        feed: moveSpeed,
        changeProgress: this.changer.progress,
        chips: this.particles.pileCount,
        fps: this.fps,
        cutWidth: cutWidthAt(this.spec, this.diameter, Math.min(s.depth, this.maxDepth())),
      });
    }
  }

  /** Arrow keys jog along the machine axis closest to the pressed screen direction. */
  private updateJog() {
    const j = this.input.jog();
    const active = (j.x !== 0 || j.y !== 0) && !this.changer.active && !this.store.state.helpOpen && !this.ui.dialogOpen;
    if (!active) {
      if (this.jogging) this.motion.stopJog();
      this.jogging = false;
      return;
    }
    this.jogging = true;
    const m = this.rig.camera.matrixWorld.elements;
    const snap = (x: number, z: number): [number, number] =>
      Math.abs(x) >= Math.abs(z) ? [Math.sign(x), 0] : [0, Math.sign(z)];
    // Camera right (column 0) and forward-on-ground (-column 2, falling back to up for top-down views).
    const right = snap(m[0], m[2]);
    const fwd = Math.abs(m[8]) + Math.abs(m[10]) > 0.2 ? snap(-m[8], -m[10]) : snap(m[4], m[6]);
    let dx = right[0] * j.x + fwd[0] * j.y;
    let dz = right[1] * j.x + fwd[1] * j.y;
    const len = Math.hypot(dx, dz);
    if (len === 0) return;
    dx /= len;
    dz /= len;
    const inMaterial = this.motion.tip.y < this.layout.top;
    const speed = (inMaterial ? this.store.state.feed / 60 : 60) * (j.fine ? 0.2 : 1);
    this.motion.jog(dx, dz, speed);
  }

  private updateGhost(depth: number) {
    const L = this.layout;
    const m = this.motion;
    const dragging = m.pressed || this.jogging;
    const show = (this.hover.on || dragging) && !this.changer.active;
    const x = dragging ? m.target.x : this.hover.x;
    const z = dragging ? m.target.z : this.hover.z;
    const d = Math.min(depth, this.maxDepth());
    const r = Math.max(0.5, profileRadius(this.spec, this.diameter, d));
    this.ghost.update(x, L.top + 0.2, z, r, dragging, show, -d);

    if (show) {
      const v = new THREE.Vector3(x, L.top, z).project(this.rig.camera);
      const dpr = this.pixel.renderer.getPixelRatio();
      const w = (this.pixel.lowW * this.pixel.scale) / dpr;
      const h = (this.pixel.lowH * this.pixel.scale) / dpr;
      const sx = ((v.x + 1) / 2) * w;
      const sy = this.canvas.clientHeight - ((v.y + 1) / 2) * h;
      this.ui.showDepthTag(sx, sy, `Z-${d.toFixed(1)}`, true);
    } else {
      this.ui.showDepthTag(0, 0, "", false);
    }
  }
}
