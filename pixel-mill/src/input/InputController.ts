import * as THREE from "three";
import { TOOLS, type CameraPresetName, type ToolId } from "../config";

export interface InputActions {
  /** Current height of the plane mouse rays are projected onto (stock top). */
  planeY(): number;
  camera(): THREE.PerspectiveCamera;
  /** Canvas CSS pixel -> NDC of the rendered (low-res, integer-scaled) frame. */
  toNdc(cssX: number, cssY: number, out: THREE.Vector2): THREE.Vector2;
  cutStart(x: number, z: number): void;
  cutMove(x: number, z: number): void;
  cutEnd(): void;
  hover(x: number, z: number, onCanvas: boolean): void;
  orbit(dx: number, dy: number): void;
  pan(dx: number, dy: number, viewH: number): void;
  zoom(delta: number): void;
  nudgeDepth(steps: number): void;
  selectTool(id: ToolId): void;
  stepDiameter(dir: 1 | -1): void;
  togglePlunge(): void;
  undo(): void;
  redo(): void;
  save(): void;
  open(): void;
  cameraPreset(name: CameraPresetName): void;
  toggleHelp(force?: boolean): void;
  blowChips(): void;
  toggleSound(): void;
  keyCutStart(): void;
  keyCutEnd(): void;
  retract(): void;
  escape(): void;
  blocked(): boolean; // dialogs open
}

type DragMode = "cut" | "orbit" | "pan" | null;

const JOG_KEYS: Record<string, [number, number]> = {
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
};

/** Held arrow keys as a screen-space direction (x right, y up). */
export interface JogInput {
  x: number;
  y: number;
  fine: boolean;
}

export class InputController {
  private mode: DragMode = null;
  private lastX = 0;
  private lastY = 0;
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private hit = new THREE.Vector3();
  private ndc = new THREE.Vector2();
  private wheelAcc = 0;
  private shift = false;
  private lockAnchor: THREE.Vector2 | null = null;
  private lockAxis: "x" | "z" | null = null;
  private lastPointer: PointerEvent | null = null;
  private canvas: HTMLCanvasElement;
  private a: InputActions;
  private jogKeys = new Set<string>();
  private keyCut = false;

  constructor(canvas: HTMLCanvasElement, actions: InputActions) {
    this.canvas = canvas;
    this.a = actions;
    canvas.addEventListener("pointerdown", this.onDown);
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onUp);
    canvas.addEventListener("pointerleave", () => this.mode === null && this.a.hover(0, 0, false));
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("auxclick", (e) => e.preventDefault());
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("keyup", (e) => {
      if (e.key === "Shift") this.setShift(false);
      this.jogKeys.delete(e.key);
      if (e.key === "Enter") this.endKeyCut();
    });
    window.addEventListener("blur", () => {
      this.setShift(false);
      this.jogKeys.clear();
      this.endKeyCut();
      if (this.mode === "cut") this.a.cutEnd();
      this.mode = null;
    });
  }

  jog(): JogInput {
    let x = 0, y = 0;
    for (const k of this.jogKeys) {
      x += JOG_KEYS[k][0];
      y += JOG_KEYS[k][1];
    }
    return { x, y, fine: this.shift };
  }

  private endKeyCut() {
    if (!this.keyCut) return;
    this.keyCut = false;
    this.a.keyCutEnd();
  }

  /** Project a pointer onto the horizontal cutting plane. */
  private project(e: { clientX: number; clientY: number }): THREE.Vector3 | null {
    const r = this.canvas.getBoundingClientRect();
    this.a.toNdc(e.clientX - r.left, e.clientY - r.top, this.ndc);
    this.ray.setFromCamera(this.ndc, this.a.camera());
    this.plane.constant = -this.a.planeY();
    return this.ray.ray.intersectPlane(this.plane, this.hit);
  }

  private setShift(on: boolean) {
    if (on === this.shift) return;
    this.shift = on;
    this.lockAxis = null;
    this.lockAnchor = null;
    if (on && this.mode === "cut" && this.lastPointer) {
      const p = this.project(this.lastPointer);
      if (p) this.lockAnchor = new THREE.Vector2(p.x, p.z);
    }
  }

  /** Apply Shift line-lock: pick the dominant axis once the drag has moved a few mm. */
  private constrain(p: THREE.Vector3): [number, number] {
    if (!this.shift || !this.lockAnchor) return [p.x, p.z];
    const dx = p.x - this.lockAnchor.x;
    const dz = p.z - this.lockAnchor.y;
    if (!this.lockAxis) {
      if (Math.hypot(dx, dz) < 2.5) return [this.lockAnchor.x, this.lockAnchor.y];
      this.lockAxis = Math.abs(dx) >= Math.abs(dz) ? "x" : "z";
    }
    return this.lockAxis === "x" ? [p.x, this.lockAnchor.y] : [this.lockAnchor.x, p.z];
  }

  private onDown = (e: PointerEvent) => {
    if (this.a.blocked()) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.lastPointer = e;
    if (e.button === 2 || (e.button === 0 && e.altKey && !e.shiftKey)) this.mode = "orbit";
    else if (e.button === 1 || (e.button === 0 && e.altKey && e.shiftKey)) this.mode = "pan";
    else if (e.button === 0) {
      const p = this.project(e);
      if (!p) return;
      this.mode = "cut";
      this.shift = e.shiftKey;
      this.lockAxis = null;
      this.lockAnchor = this.shift ? new THREE.Vector2(p.x, p.z) : null;
      this.a.cutStart(p.x, p.z);
    }
    e.preventDefault();
  };

  private onMove = (e: PointerEvent) => {
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.lastPointer = e;
    if (e.shiftKey !== this.shift && this.mode === "cut") this.setShift(e.shiftKey);
    switch (this.mode) {
      case "orbit":
        this.a.orbit(dx, dy);
        return;
      case "pan":
        this.a.pan(dx, dy, this.canvas.clientHeight);
        return;
      case "cut": {
        const p = this.project(e);
        if (p) {
          const [x, z] = this.constrain(p);
          this.a.cutMove(x, z);
          this.a.hover(x, z, true);
        }
        return;
      }
      default:
        if (e.target === this.canvas) {
          const p = this.project(e);
          if (p) this.a.hover(p.x, p.z, true);
        }
    }
  };

  private onUp = (e: PointerEvent) => {
    if (this.mode === "cut") this.a.cutEnd();
    this.mode = null;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (this.a.blocked()) return;
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    if (e.ctrlKey || e.metaKey) {
      this.a.zoom(delta * (e.ctrlKey && Math.abs(delta) < 10 ? 6 : 1));
      return;
    }
    // Accumulate so trackpads (many tiny deltas) and mouse wheels (big notches) both step nicely.
    this.wheelAcc += delta;
    const steps = Math.trunc(this.wheelAcc / 50);
    if (steps !== 0) {
      this.wheelAcc -= steps * 50;
      this.a.nudgeDepth(steps);
    }
  };

  private onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA") && (t as HTMLInputElement).type !== "range") {
      if (e.key === "Escape") this.a.escape();
      return;
    }
    if (e.key === "Shift") {
      this.setShift(true);
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod) {
      if (k === "z") {
        e.preventDefault();
        e.shiftKey ? this.a.redo() : this.a.undo();
      } else if (k === "y") {
        e.preventDefault();
        this.a.redo();
      } else if (k === "s") {
        e.preventDefault();
        this.a.save();
      } else if (k === "o") {
        e.preventDefault();
        this.a.open();
      }
      return;
    }
    if (e.key === "Escape") return this.a.escape();
    if (e.key === "?" || (e.key === "/" && e.shiftKey)) return this.a.toggleHelp();
    if (this.a.blocked()) return;
    if (e.code === "Space") {
      e.preventDefault();
      if (!e.repeat) this.a.togglePlunge();
      return;
    }
    if (e.key in JOG_KEYS) {
      e.preventDefault();
      this.jogKeys.add(e.key);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (!e.repeat && !this.keyCut) {
        this.keyCut = true;
        this.a.keyCutStart();
      }
      return;
    }
    const tool = TOOLS.find((tt) => String(tt.slot) === e.key);
    if (tool) return this.a.selectTool(tool.id);
    switch (e.key) {
      case "[": return this.a.stepDiameter(-1);
      case "]": return this.a.stepDiameter(1);
      case "-": case "_": return this.a.nudgeDepth(-1);
      case "=": case "+": return this.a.nudgeDepth(1);
    }
    switch (k) {
      case "t": return this.a.cameraPreset("top");
      case "f": return this.a.cameraPreset("front");
      case "s": return this.a.cameraPreset("side");
      case "i": return this.a.cameraPreset("iso");
      case "b": return this.a.blowChips();
      case "m": return this.a.toggleSound();
      case "r": return this.a.retract();
    }
  };
}
