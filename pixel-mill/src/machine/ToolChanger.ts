import * as THREE from "three";
import { MACHINE } from "../config";

interface Step {
  to?: THREE.Vector3;
  action?: () => void;
  dur: number;
  spin?: "down" | "up";
}

export interface ToolChangePlan {
  head: THREE.Vector3; // current spindle nose position
  oldSlot: THREE.Vector3; // where the mounted tool gets parked
  newSlot: THREE.Vector3; // where the requested tool waits
  returnHead: THREE.Vector3; // nose position to finish at
  safeY: number; // nose height that clears stock, vise and rack
  onRelease: () => void;
  onGrab: () => void;
  onDone: () => void;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * Automatic tool change as a sequence of eased moves: spin down, rise, park the
 * current tool in its rack slot, pick the new one, return and spin up.
 */
export class ToolChanger {
  readonly head = new THREE.Vector3();
  /** Spindle speed multiplier 0..1 while changing. */
  spinFactor = 1;
  private steps: Step[] = [];
  private i = 0;
  private t = 0;
  private from = new THREE.Vector3();
  private done: (() => void) | null = null;

  get active() {
    return this.done !== null;
  }

  start(p: ToolChangePlan) {
    const up = (v: THREE.Vector3) => new THREE.Vector3(v.x, p.safeY, v.z);
    const path: Step[] = [
      { to: up(p.head), dur: 0, spin: "down" },
      { to: up(p.oldSlot), dur: 0 },
      { to: p.oldSlot.clone(), dur: 0 },
      { action: p.onRelease, dur: 0.16 },
      { to: up(p.oldSlot), dur: 0 },
      { to: up(p.newSlot), dur: 0 },
      { to: p.newSlot.clone(), dur: 0 },
      { action: p.onGrab, dur: 0.16 },
      { to: up(p.newSlot), dur: 0 },
      { to: up(p.returnHead), dur: 0 },
      { to: p.returnHead.clone(), dur: 0, spin: "up" },
    ];
    let prev = p.head.clone();
    for (const s of path) {
      if (s.to) {
        s.dur = Math.max(0.12, prev.distanceTo(s.to) / MACHINE.toolChangeRapid);
        prev = s.to;
      }
    }
    this.steps = path;
    this.i = 0;
    this.t = 0;
    this.head.copy(p.head);
    this.from.copy(p.head);
    this.done = p.onDone;
  }

  update(dt: number) {
    if (!this.done) return;
    this.t += dt;
    while (this.i < this.steps.length) {
      const s = this.steps[this.i];
      const k = Math.min(1, this.t / s.dur);
      if (s.to) this.head.lerpVectors(this.from, s.to, smooth(k));
      if (s.spin === "down") this.spinFactor = 1 - k;
      else if (s.spin === "up") this.spinFactor = k;
      if (k < 1) return;
      this.t -= s.dur;
      if (s.action) s.action();
      if (s.to) this.from.copy(s.to);
      this.i++;
    }
    const cb = this.done;
    this.done = null;
    this.spinFactor = 1;
    cb();
  }

  /** Normalised progress of the whole sequence. */
  get progress() {
    if (!this.done) return 1;
    const total = this.steps.reduce((a, s) => a + s.dur, 0);
    const doneT = this.steps.slice(0, this.i).reduce((a, s) => a + s.dur, 0) + this.t;
    return Math.min(1, doneT / total);
  }
}
