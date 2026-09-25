import * as THREE from "three";
import { COLORS, MACHINE, TOOLS } from "../config";
import type { Layout } from "./layout";

const mats = new Map<string, THREE.MeshLambertMaterial>();
function mat(color: string) {
  let m = mats.get(color);
  if (!m) mats.set(color, (m = new THREE.MeshLambertMaterial({ color })));
  return m;
}

/** Axis-aligned box from min/max corners. */
function box(parent: THREE.Object3D, color: string | THREE.Material, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)),
    typeof color === "string" ? mat(color) : color,
  );
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  parent.add(m);
  return m;
}

function cyl(parent: THREE.Object3D, color: string | THREE.Material, r0: number, r1: number, y0: number, y1: number, seg = 12) {
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(r1, r0, y1 - y0, seg),
    typeof color === "string" ? mat(color) : color,
  );
  m.position.y = (y0 + y1) / 2;
  parent.add(m);
  return m;
}

/** Inward-facing plane: visible from inside the enclosure, culled from outside (dollhouse view). */
function panel(parent: THREE.Object3D, material: THREE.Material, w: number, h: number, pos: THREE.Vector3, rotY: number, rotX = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
  m.position.copy(pos);
  m.rotation.set(rotX, rotY, 0, "YXZ");
  parent.add(m);
  return m;
}

export type LightState = "ready" | "cutting" | "change" | "alarm";

/**
 * Stylised compact gantry mill, built from primitives. Original design: a
 * graphite cabinet, amber accents, teal glass, moving gantry on side rails.
 */
export class MachineModel {
  readonly root = new THREE.Group();
  /** Rotating tool mount at the spindle nose (origin = nose point). */
  readonly spinner = new THREE.Group();
  readonly rack = new THREE.Group();
  private vise = new THREE.Group();
  private gantry = new THREE.Group();
  private carriage = new THREE.Group();
  private zSlide = new THREE.Group();
  private nozzle = new THREE.Object3D();
  private lights: { mesh: THREE.Mesh; on: string; off: string }[] = [];
  private blink = 0;
  private lightState: LightState = "ready";
  private xrayParts: THREE.Object3D[] = [];
  private xray = false;

  constructor() {
    this.root.name = "machine";
    this.buildStatic();
    this.buildGantry();
    this.root.add(this.vise, this.rack, this.gantry);
    // Everything on the gantry except the tool and spindle nose can be hidden for top-down views.
    this.gantry.traverse((o) => {
      if (o instanceof THREE.Mesh) this.xrayParts.push(o);
    });
  }

  /** Hide the gantry and spindle housing so the stock is visible from above. */
  setXray(on: boolean) {
    if (on === this.xray) return;
    this.xray = on;
    for (const o of this.xrayParts) o.visible = !on;
    this.applyXrayToTool();
  }

  /** Mounted tool: hide holder ring + nut in x-ray so only the cutter shows. */
  applyXrayToTool() {
    this.spinner.traverse((o) => {
      if (o.name === "holder") o.visible = !this.xray;
    });
  }

  private buildStatic() {
    const r = this.root;
    const E = MACHINE.enclosure;
    // Base cabinet and table.
    box(r, COLORS.cabinet, -E.halfX, -130, -E.halfZ, E.halfX, -18, E.halfZ);
    box(r, COLORS.accent, -E.halfX - 0.5, -40, E.halfZ - 0.5, E.halfX + 0.5, -34, E.halfZ + 0.5);
    box(r, COLORS.table, -175, -18, -150, 175, 0, 150);
    for (let z = -120; z <= 120; z += 40) box(r, COLORS.tableSlot, -175, 0, z - 3, 175, 0.35, z + 3);
    // Gantry rails.
    for (const s of [-1, 1]) {
      box(r, COLORS.cabinetDark, s * 205 - 10, -18, -E.halfZ + 10, s * 205 + 10, -10, E.halfZ - 10);
      box(r, COLORS.rail, s * 205 - 5, -10, -E.halfZ + 10, s * 205 + 5, -6, E.halfZ - 10);
    }

    // Enclosure frame.
    const frame = mat(COLORS.cabinet);
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        box(r, frame, sx * E.halfX - 6, E.bottom, sz * E.halfZ - 6, sx * E.halfX + 6, E.top, sz * E.halfZ + 6);
    for (const sz of [-1, 1]) box(r, frame, -E.halfX, E.top - 12, sz * E.halfZ - 6, E.halfX, E.top, sz * E.halfZ + 6);
    for (const sx of [-1, 1]) box(r, frame, sx * E.halfX - 6, E.top - 12, -E.halfZ, sx * E.halfX + 6, E.top, E.halfZ);
    // Front door frame, split in two doors with amber handles.
    box(r, frame, -6, E.bottom, E.halfZ - 5, 6, E.top, E.halfZ + 5);
    box(r, frame, -E.halfX, 120, E.halfZ - 4, E.halfX, 126, E.halfZ + 4);
    for (const sx of [-1, 1]) box(r, COLORS.accent, sx * 14 - 3, 150, E.halfZ + 4, sx * 14 + 3, 210, E.halfZ + 9);

    const wall = new THREE.MeshLambertMaterial({ color: COLORS.cabinetDark });
    const roof = new THREE.MeshLambertMaterial({ color: COLORS.cabinet });
    const glass = new THREE.MeshBasicMaterial({
      color: COLORS.glass, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide,
    });
    const H = E.top - E.bottom;
    const midY = (E.top + E.bottom) / 2;
    panel(r, wall, E.halfX * 2, H, new THREE.Vector3(0, midY, -E.halfZ), 0);
    panel(r, roof, E.halfX * 2, E.halfZ * 2, new THREE.Vector3(0, E.top, 0), 0, Math.PI / 2);
    panel(r, glass, E.halfX * 2, H, new THREE.Vector3(0, midY, E.halfZ), Math.PI);
    panel(r, glass, E.halfZ * 2, H, new THREE.Vector3(-E.halfX, midY, 0), Math.PI / 2);
    panel(r, glass, E.halfZ * 2, H, new THREE.Vector3(E.halfX, midY, 0), -Math.PI / 2);
    // Back wall details: accent stripe and a vent grille.
    box(r, COLORS.accentDark, -E.halfX, 240, -E.halfZ, E.halfX, 246, -E.halfZ + 2);
    for (let i = 0; i < 8; i++) box(r, COLORS.cabinet, -70 + i * 20, 200, -E.halfZ, -60 + i * 20, 225, -E.halfZ + 2);

    // Control pendant on the right front post.
    const pend = new THREE.Group();
    pend.position.set(E.halfX + 14, 160, E.halfZ - 50);
    pend.rotation.y = -0.5;
    box(pend, COLORS.cabinet, -6, -40, -45, 6, 40, 45);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(60, 40), new THREE.MeshBasicMaterial({ color: "#1d6630" }));
    screen.position.set(6.1, 8, 0);
    screen.rotation.y = Math.PI / 2;
    pend.add(screen);
    box(pend, COLORS.red, 6, -30, 20, 10, -22, 28);
    r.add(pend);
  }

  private buildGantry() {
    const g = this.gantry;
    const zc = -MACHINE.gantryOffsetZ;
    // Posts and beam.
    for (const s of [-1, 1]) {
      box(g, COLORS.gantry, s * 205 - 12, -6, zc - 18, s * 205 + 12, 200, zc + 18);
      box(g, COLORS.accent, s * 205 - 12.5, 60, zc + 17, s * 205 + 12.5, 66, zc + 19);
    }
    box(g, COLORS.gantryLight, -217, 170, zc - 15, 217, 200, zc + 15);
    box(g, COLORS.rail, -200, 176, zc + 15, 200, 180, zc + 17);
    box(g, COLORS.rail, -200, 190, zc + 15, 200, 194, zc + 17);
    const label = this.makeLabel();
    label.position.set(-120, 185, zc + 15.2);
    g.add(label);

    // Stack light on the right post.
    const stack = new THREE.Group();
    stack.position.set(205, 200, zc);
    cyl(stack, COLORS.cabinetDark, 4, 4, 0, 8);
    const defs = [
      { on: COLORS.green, off: "#1d6630" },
      { on: COLORS.amber, off: "#6e3b12" },
      { on: COLORS.red, off: "#a3212e" },
    ];
    defs.forEach((d, i) => {
      const m = cyl(stack, new THREE.MeshBasicMaterial({ color: d.off }), 6, 6, 8 + i * 9, 16 + i * 9, 8);
      this.lights.push({ mesh: m, ...d });
    });
    g.add(stack);

    // X carriage and Z slide.
    box(this.carriage, COLORS.gantry, -30, 150, -36, 30, 215, -26);
    box(this.carriage, COLORS.accent, -30.5, 205, -36.5, 30.5, 209, -25.5);
    g.add(this.carriage);

    const z = this.zSlide;
    box(z, COLORS.gantryLight, -15, 20, -23, 15, 150, -16);
    cyl(z, COLORS.steelDark, 9, 12, 0, 12);
    cyl(z, COLORS.spindle, 16, 16, 12, 100, 16);
    cyl(z, COLORS.accent, 16.5, 16.5, 84, 90, 16);
    cyl(z, COLORS.spindleLight, 13, 13, 100, 114, 16);
    box(z, COLORS.cabinetDark, -8, 114, -8, 8, 124, 8);
    // Coolant nozzle: a jointed hose ending near the tool.
    const hose = mat(COLORS.viseLight);
    const joints = [
      new THREE.Vector3(-16, 30, -10),
      new THREE.Vector3(-22, 14, -12),
      new THREE.Vector3(-18, 0, -10),
      new THREE.Vector3(-12, -9, -7),
    ];
    for (let i = 0; i < joints.length - 1; i++) {
      const a = joints[i], b = joints[i + 1];
      const len = a.distanceTo(b);
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, len, 6), hose);
      seg.position.copy(a).add(b).multiplyScalar(0.5);
      seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      z.add(seg);
    }
    this.nozzle.position.copy(joints[joints.length - 1]);
    z.add(this.nozzle);

    z.add(this.spinner);
    this.carriage.add(z);
  }

  private makeLabel() {
    const c = document.createElement("canvas");
    c.width = 96;
    c.height = 8;
    const ctx = c.getContext("2d")!;
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    const draw = () => {
      ctx.fillStyle = COLORS.cabinetDark;
      ctx.fillRect(0, 0, 96, 8);
      ctx.fillStyle = COLORS.accent;
      ctx.font = "8px 'Press Start 2P'";
      ctx.textBaseline = "top";
      ctx.fillText("PM-3 HSC", 2, 0);
      tex.needsUpdate = true;
    };
    draw();
    document.fonts?.ready.then(draw);
    return new THREE.Mesh(new THREE.PlaneGeometry(96, 8), new THREE.MeshBasicMaterial({ map: tex }));
  }

  /** Rebuild the parts that depend on stock size. */
  setLayout(layout: Layout) {
    for (const grp of [this.vise, this.rack]) {
      for (const child of [...grp.children]) {
        if (child.name === "tool-parked") continue;
        grp.remove(child);
        child.traverse((o) => o instanceof THREE.Mesh && o.geometry.dispose());
      }
    }
    const v = this.vise;
    const b = layout.viseBase;
    const hz = layout.size.z / 2;
    const T = MACHINE.jawThickness;
    const hw = layout.jawWidth / 2;
    box(v, COLORS.vise, b.x0, 0, b.z0, b.x1, b.top, b.z1);
    box(v, COLORS.viseLight, b.x0 - 0.3, b.top - 2, b.z0 - 0.3, b.x1 + 0.3, b.top - 1, b.z1 + 0.3);
    // Fixed jaw (back) and moving jaw (front) with steel jaw plates.
    box(v, COLORS.vise, -hw, b.top, -hz - T, hw, layout.jawTop, -hz - 2);
    box(v, COLORS.jaw, -hw, b.top, -hz - 2, hw, layout.jawTop, -hz);
    box(v, COLORS.vise, -hw, b.top, hz + 2, hw, layout.jawTop, hz + T);
    box(v, COLORS.jaw, -hw, b.top, hz, hw, layout.jawTop, hz + 2);
    // Screw and crank handle.
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 24, 8), mat(COLORS.steelLight));
    screw.rotation.x = Math.PI / 2;
    screw.position.set(0, b.top - 5, b.z1 + 10);
    v.add(screw);
    box(v, COLORS.steel, -3, b.top - 12, b.z1 + 20, 3, b.top + 2, b.z1 + 24);
    box(v, COLORS.accent, -22, b.top - 12, b.z1 + 20, -2, b.top - 8, b.z1 + 24);
    // Clamp bolts to the table.
    for (const sx of [-1, 1]) box(v, COLORS.steelDark, sx * (hw + 8) - 4, 0, -4, sx * (hw + 8) + 4, 5, 4);

    // Tool rack: two rails with a slot per tool, standing on legs.
    const rk = this.rack;
    const y = MACHINE.rack.shelfY;
    const z0 = layout.rackZ;
    const halfW = (TOOLS.length / 2) * MACHINE.rack.slotSpacing;
    for (const s of [-1, 1]) box(rk, COLORS.gantryLight, -halfW, y - 5, z0 + s * 13 - 3, halfW, y, z0 + s * 13 + 3);
    for (const sx of [-1, 1]) box(rk, COLORS.gantry, sx * halfW - 8, 0, z0 - 16, sx * halfW, y, z0 + 16);
    TOOLS.forEach((t, i) => {
      const x = layout.rackSlots[i].x;
      box(rk, t.color, x - 6, y - 5, z0 + 16, x + 6, y - 1, z0 + 17);
    });
  }

  setHead(p: THREE.Vector3) {
    this.gantry.position.z = p.z;
    this.carriage.position.x = p.x;
    this.zSlide.position.y = p.y;
  }

  spin(rpm: number, dt: number) {
    // Visual speed is heavily scaled down so the stripes read as rotation, not noise.
    this.spinner.rotation.y -= (rpm / 30000) * dt * Math.PI * 2 * 6;
  }

  nozzleWorld(target: THREE.Vector3) {
    return this.nozzle.getWorldPosition(target);
  }

  setLight(state: LightState, dt: number) {
    this.lightState = state;
    this.blink += dt;
    const flash = Math.floor(this.blink * 6) % 2 === 0;
    const on = [
      state === "ready" || state === "cutting",
      state === "change" || (state === "cutting" && flash),
      state === "alarm" && flash,
    ];
    this.lights.forEach((l, i) => (l.mesh.material as THREE.MeshBasicMaterial).color.set(on[i] ? l.on : l.off));
  }

  get light() {
    return this.lightState;
  }
}
