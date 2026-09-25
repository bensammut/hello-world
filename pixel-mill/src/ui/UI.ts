import {
  LIMITS, MAX_GRID, MIN_GRID, STOCK_PRESETS, TOOLS, TOOL_BY_ID, VOXEL_MM,
  type CameraPresetName, type ToolId,
} from "../config";
import type { AppState, Store } from "../state/store";
import { ICONS, spriteSvg, toolIcon } from "./sprites";

export interface UIActions {
  selectTool(id: ToolId): void;
  stepDiameter(dir: 1 | -1): void;
  setDepth(mm: number): void;
  setFeed(v: number): void;
  setRpm(v: number): void;
  togglePlunge(): void;
  toggleSound(): void;
  undo(): void;
  redo(): void;
  newStock(mm: [number, number, number]): void;
  save(): void;
  open(file: File): void;
  exportStl(): void;
  camera(name: CameraPresetName): void;
  blowChips(): void;
  toggleHelp(force?: boolean): void;
  maxDepth(): number;
  currentStockMm(): [number, number, number];
}

export interface LiveReadout {
  x: number;
  y: number;
  z: number;
  rpm: number;
  feed: number;
  changeProgress: number;
  chips: number;
  fps: number;
  cutWidth: number;
}

const $ = <T extends HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;
const fmt = (n: number, d = 1) => n.toFixed(d);
/** Only touch the DOM when the text actually changes (renders run many times a second). */
const txt = (el: HTMLElement, text: string) => {
  if (el.textContent !== text) el.textContent = text;
};
const pad = (n: number, w: number) => String(Math.round(n)).padStart(w, " ");

function mmss(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const SHORTCUTS: [string, string][] = [
  ["LMB DRAG", "Move tool / cut"],
  ["SHIFT+DRAG", "Lock to a straight line (X or Y)"],
  ["WHEEL", "Depth (0.5 mm steps)"],
  ["SPACE", "Toggle plunge mode"],
  ["ARROWS", "Jog tool along X / Y (relative to the view)"],
  ["SHIFT+ARROWS", "Fine jog"],
  ["ENTER (HOLD)", "Lower tool to depth / cut, like holding LMB"],
  ["R", "Retract tool"],
  ["RMB DRAG / ALT+DRAG", "Orbit camera"],
  ["MMB DRAG / ALT+SHIFT+DRAG", "Pan camera"],
  ["CTRL+WHEEL / PINCH", "Zoom"],
  ["1 - 6", "Select tool (auto tool change)"],
  ["[  ]", "Tool diameter down / up"],
  ["- / =", "Depth up / down"],
  ["T F S I", "Camera: top / front / side / iso"],
  ["CTRL+Z", "Undo stroke"],
  ["CTRL+SHIFT+Z / CTRL+Y", "Redo"],
  ["CTRL+S / CTRL+O", "Save / open project"],
  ["B", "Blow off chips"],
  ["M", "Sound on / off"],
  ["?", "This help"],
];

export class UI {
  readonly root: HTMLElement;
  private warnEl: HTMLElement;
  private toastEl: HTMLElement;
  private toastTimer = 0;
  private depthTag: HTMLElement;
  private live: Record<string, HTMLElement> = {};
  private fileInput: HTMLInputElement;
  private act: UIActions;

  constructor(host: HTMLElement, store: Store, act: UIActions) {
    this.act = act;
    this.root = host;
    host.innerHTML = this.markup();
    this.warnEl = $(host, "#warn");
    this.toastEl = $(host, "#toast");
    this.depthTag = $(host, "#depth-tag");
    this.fileInput = $(host, "#file-input");
    for (const el of host.querySelectorAll<HTMLElement>("[data-live]")) this.live[el.dataset.live!] = el;
    this.bind();
    store.subscribe((s) => this.render(s));
  }

  private markup() {
    const slots = TOOLS.map(
      (t) => `
      <li><button class="slot" data-tool="${t.id}" title="${t.name} — ${t.blurb} (key ${t.slot})">
        <span class="key">${t.slot}</span>
        <span class="icon">${toolIcon(t.id, t.color, 3)}</span>
        <span class="info"><b>${t.short}</b><i data-dia="${t.id}"></i></span>
      </button></li>`,
    ).join("");
    const cams = (["top", "front", "side", "iso"] as const)
      .map((c) => `<button data-cam="${c}">${c.toUpperCase()}</button>`)
      .join("");
    const help = SHORTCUTS.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("");
    const presets = STOCK_PRESETS.map(
      (p) => `<button type="button" data-preset="${p.mm.join(",")}">${p.name}<small>${p.mm[0]}×${p.mm[2]}×${p.mm[1]}</small></button>`,
    ).join("");

    return `
    <header class="panel topbar">
      <div class="brand">${spriteSvg(ICONS.logo, 3)}<div><h1>PIXEL MILL</h1><small>PM-3 HIGH SPEED VOXEL MILL</small></div></div>
      <nav>
        <button data-act="new" title="New stock">NEW</button>
        <button data-act="open" title="Open project (Ctrl+O)">OPEN</button>
        <button data-act="save" title="Save project (Ctrl+S)">SAVE</button>
        <button data-act="stl" title="Export part as STL">STL</button>
        <span class="sep"></span>
        <button data-act="undo" title="Undo (Ctrl+Z)">UNDO <em data-live="undo">0</em></button>
        <button data-act="redo" title="Redo (Ctrl+Shift+Z)">REDO <em data-live="redo">0</em></button>
        <span class="sep"></span>
        <button data-act="sound" class="sound" title="Sound (M)"><span data-live="soundIcon"></span><span data-live="soundLabel">SOUND OFF</span></button>
        <button data-act="help" title="Shortcuts (?)">?</button>
      </nav>
    </header>

    <aside class="panel magazine">
      <h2>TOOL MAGAZINE</h2>
      <ol class="slots">${slots}</ol>
      <div class="dia">
        <button data-act="dia-" title="Smaller ( [ )">[</button>
        <span data-live="dia">Ø 4.0</span>
        <button data-act="dia+" title="Larger ( ] )">]</button>
      </div>
      <p class="blurb" data-live="blurb"></p>
    </aside>

    <aside class="panel hud">
      <div class="screen">
        <div class="hud-head"><span>PM-3 CNC</span><span class="status" data-live="status">READY</span></div>
        <table class="readout">
          <tr><th>T</th><td data-live="tool"></td></tr>
          <tr><th>Ø</th><td data-live="toolDia"></td></tr>
          <tr><th>S</th><td><span data-live="rpm"></span><div class="bar"><i data-live="rpmBar"></i></div></td></tr>
          <tr><th>F</th><td data-live="feed"></td></tr>
          <tr><th>X</th><td data-live="x"></td></tr>
          <tr><th>Y</th><td data-live="y"></td></tr>
          <tr><th>Z</th><td data-live="z"></td></tr>
          <tr><th>W</th><td data-live="width"></td></tr>
          <tr><th>M</th><td data-live="mode"></td></tr>
        </table>
      </div>
      <label class="slider depth">
        <span>DEPTH <b data-live="depth">1.5</b> MM</span>
        <input type="range" data-input="depth" min="0" step="${LIMITS.depthStep}">
      </label>
      <label class="slider">
        <span>FEED <b data-live="feedSet"></b> MM/MIN</span>
        <input type="range" data-input="feed" min="${LIMITS.feed.min}" max="${LIMITS.feed.max}" step="${LIMITS.feed.step}">
      </label>
      <label class="slider">
        <span>SPINDLE <b data-live="rpmSet"></b> RPM</span>
        <input type="range" data-input="rpm" min="${LIMITS.rpm.min}" max="${LIMITS.rpm.max}" step="${LIMITS.rpm.step}">
      </label>
      <div class="hud-buttons">
        <button data-act="plunge" data-live="plunge">PLUNGE OFF</button>
        <button data-act="blow" title="Blow off chips (B)">${spriteSvg(ICONS.blower, 2)} BLOW CHIPS</button>
      </div>
    </aside>

    <section class="panel stats">
      <h2>JOB STATS</h2>
      <table>
        <tr><th>REMOVED</th><td><span data-live="removed">0.00</span> CM³</td></tr>
        <tr><th>CUT TIME</th><td data-live="cutTime">00:00</td></tr>
        <tr><th>TOOL CHG</th><td data-live="toolChanges">0</td></tr>
        <tr><th>STROKES</th><td data-live="strokes">0</td></tr>
        <tr><th>CHIPS</th><td data-live="chips">0</td></tr>
        <tr><th>STOCK</th><td data-live="stock"></td></tr>
      </table>
      <div class="fps" data-live="fps"></div>
    </section>

    <div class="panel cams">${cams}</div>
    <div class="hint">LMB CUT · ARROWS JOG · ENTER CUT · WHEEL DEPTH · SPACE PLUNGE · RMB ORBIT · MMB PAN · CTRL+WHEEL ZOOM · ? HELP</div>

    <div id="warn" class="warn"><div data-live="warnText">VISE COLLISION</div></div>
    <div id="depth-tag" class="depth-tag"></div>
    <div id="toast" class="toast"></div>

    <div class="overlay" id="help" hidden>
      <div class="panel dialog">
        <h2>SHORTCUTS</h2>
        <table class="keys">${help}</table>
        <p class="note">Plunge mode: the tool drops to depth only while the button is held.
        Drill is plunge-only. The tool lags a fast cursor (feed rate); the orange ring is the target.</p>
        <button data-act="help-close">CLOSE [ESC]</button>
      </div>
    </div>

    <div class="overlay" id="newstock" hidden>
      <form class="panel dialog" id="newstock-form">
        <h2>NEW STOCK</h2>
        <div class="presets">${presets}</div>
        <div class="dims">
          <label>X <input name="x" type="number" step="${VOXEL_MM}" min="${MIN_GRID.x * VOXEL_MM}" max="${MAX_GRID.x * VOXEL_MM}"> MM</label>
          <label>Y <input name="z" type="number" step="${VOXEL_MM}" min="${MIN_GRID.z * VOXEL_MM}" max="${MAX_GRID.z * VOXEL_MM}"> MM</label>
          <label>Z <input name="y" type="number" step="${VOXEL_MM}" min="${MIN_GRID.y * VOXEL_MM}" max="${MAX_GRID.y * VOXEL_MM}"> MM</label>
        </div>
        <p class="note">Machine axes: X width, Y depth, Z height. ${VOXEL_MM} mm voxels. Clears undo history.</p>
        <div class="row"><button type="submit">LOAD STOCK</button><button type="button" data-act="newstock-close">CANCEL</button></div>
      </form>
    </div>
    <input type="file" id="file-input" accept=".json,application/json" hidden>
    `;
  }

  private bind() {
    const r = this.root;
    r.addEventListener("click", (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>("button");
      if (!el) return;
      // Buttons must not keep focus, otherwise Space would re-trigger them.
      el.blur();
      if (el.dataset.tool) return this.act.selectTool(el.dataset.tool as ToolId);
      if (el.dataset.cam) return this.act.camera(el.dataset.cam as CameraPresetName);
      if (el.dataset.preset) {
        const [x, y, z] = el.dataset.preset.split(",").map(Number);
        this.fillStockForm(x, y, z);
        return;
      }
      switch (el.dataset.act) {
        case "new": return this.openNewStock();
        case "open": return this.fileInput.click();
        case "save": return this.act.save();
        case "stl": return this.act.exportStl();
        case "undo": return this.act.undo();
        case "redo": return this.act.redo();
        case "sound": return this.act.toggleSound();
        case "help": return this.act.toggleHelp();
        case "help-close": return this.act.toggleHelp(false);
        case "newstock-close": return this.closeNewStock();
        case "dia-": return this.act.stepDiameter(-1);
        case "dia+": return this.act.stepDiameter(1);
        case "plunge": return this.act.togglePlunge();
        case "blow": return this.act.blowChips();
      }
    });
    r.addEventListener("input", (e) => {
      const el = e.target as HTMLInputElement;
      const v = Number(el.value);
      if (el.dataset.input === "depth") this.act.setDepth(v);
      else if (el.dataset.input === "feed") this.act.setFeed(v);
      else if (el.dataset.input === "rpm") this.act.setRpm(v);
    });
    // Sliders shouldn't hold keyboard focus either (arrow keys / space).
    r.addEventListener("change", (e) => (e.target as HTMLElement).blur?.());
    $(r, "#newstock-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const f = e.target as HTMLFormElement;
      const read = (n: string) => Number((f.elements.namedItem(n) as HTMLInputElement).value);
      this.act.newStock([read("x"), read("y"), read("z")]);
      this.closeNewStock();
    });
    this.fileInput.addEventListener("change", () => {
      const file = this.fileInput.files?.[0];
      if (file) this.act.open(file);
      this.fileInput.value = "";
    });
    for (const id of ["#help", "#newstock"]) {
      $(r, id).addEventListener("pointerdown", (e) => {
        if (e.target === e.currentTarget) id === "#help" ? this.act.toggleHelp(false) : this.closeNewStock();
      });
    }
  }

  private fillStockForm(x: number, y: number, z: number) {
    const f = $(this.root, "#newstock-form") as HTMLFormElement;
    (f.elements.namedItem("x") as HTMLInputElement).value = String(x);
    (f.elements.namedItem("y") as HTMLInputElement).value = String(y);
    (f.elements.namedItem("z") as HTMLInputElement).value = String(z);
  }

  openNewStock() {
    const [x, y, z] = this.act.currentStockMm();
    this.fillStockForm(x, y, z);
    $(this.root, "#newstock").hidden = false;
  }

  closeNewStock() {
    $(this.root, "#newstock").hidden = true;
  }

  get dialogOpen() {
    return !$(this.root, "#newstock").hidden;
  }

  private render(s: AppState) {
    const tool = TOOL_BY_ID[s.toolId];
    const dia = tool.diameters[s.diameterIndex[s.toolId]];
    for (const b of this.root.querySelectorAll<HTMLElement>(".slot")) b.classList.toggle("active", b.dataset.tool === s.toolId);
    for (const t of TOOLS) {
      const el = this.root.querySelector<HTMLElement>(`[data-dia="${t.id}"]`);
      if (el) txt(el, `Ø${fmt(t.diameters[s.diameterIndex[t.id]])}`);
    }
    const L = this.live;
    txt(L.dia, `Ø ${fmt(dia)} MM`);
    txt(L.blurb, `${tool.name}: ${tool.blurb}. Max depth ${tool.maxDepth} mm.${tool.coneDeg ? ` ${tool.coneDeg}° tip.` : ""}`);
    txt(L.tool, `T${tool.slot} ${tool.name}`);
    txt(L.toolDia, `${fmt(dia)} MM  ${tool.flutes}FL`);
    txt(L.depth, fmt(s.depth));
    txt(L.feedSet, String(s.feed));
    txt(L.rpmSet, String(s.rpm));
    txt(L.mode, tool.plungeOnly ? "DRILL CYCLE" : s.plungeMode ? "PLUNGE" : "CONTOUR");
    txt(L.plunge, s.plungeMode ? "PLUNGE ON [SPC]" : "PLUNGE OFF [SPC]");
    L.plunge.classList.toggle("on", s.plungeMode);
    txt(L.soundLabel, s.soundOn ? "SOUND ON" : "SOUND OFF");
    const icon = s.soundOn ? "on" : "off";
    if (L.soundIcon.dataset.icon !== icon) {
      L.soundIcon.dataset.icon = icon;
      L.soundIcon.innerHTML = spriteSvg(s.soundOn ? ICONS.speakerOn : ICONS.speakerOff, 2);
    }
    txt(L.undo, String(s.undoDepth));
    txt(L.redo, String(s.redoDepth));
    txt(L.removed, fmt(s.stats.removedMm3 / 1000, 2));
    txt(L.cutTime, mmss(s.stats.cutTime));
    txt(L.toolChanges, String(s.stats.toolChanges));
    txt(L.strokes, String(s.stats.strokes));
    const [sx, sy, sz] = this.act.currentStockMm();
    txt(L.stock, `${sx}×${sz}×${sy}`);

    const depthInput = $<HTMLInputElement>(this.root, '[data-input="depth"]');
    depthInput.max = String(this.act.maxDepth());
    depthInput.value = String(s.depth);
    $<HTMLInputElement>(this.root, '[data-input="feed"]').value = String(s.feed);
    $<HTMLInputElement>(this.root, '[data-input="rpm"]').value = String(s.rpm);
    for (const b of this.root.querySelectorAll<HTMLElement>("[data-cam]")) b.classList.toggle("active", b.dataset.cam === s.camera);
    $(this.root, "#help").hidden = !s.helpOpen;
  }

  /** Per-frame readouts (throttled by the caller). */
  updateLive(s: AppState, r: LiveReadout) {
    const L = this.live;
    const status = s.status === "TOOL CHANGE" ? `TOOL CHG ${Math.round(r.changeProgress * 100)}%` : s.status;
    txt(L.status, status);
    L.status.dataset.state = s.status;
    txt(L.rpm, `${pad(r.rpm, 5)} RPM`);
    const bar = `${Math.min(100, (r.rpm / LIMITS.rpm.max) * 100).toFixed(1)}%`;
    if (L.rpmBar.style.width !== bar) L.rpmBar.style.width = bar;
    txt(L.feed, `${pad(r.feed, 4)} MM/MIN`);
    txt(L.x, `${r.x >= 0 ? "+" : ""}${fmt(r.x, 2)}`);
    txt(L.y, `${r.y >= 0 ? "+" : ""}${fmt(r.y, 2)}`);
    txt(L.z, `${r.z >= 0 ? "+" : ""}${fmt(r.z, 2)}`);
    txt(L.width, `${fmt(r.cutWidth, 2)} MM CUT`);
    txt(L.chips, String(r.chips));
    txt(L.fps, `${Math.round(r.fps)} FPS`);
  }

  showDepthTag(x: number, y: number, text: string, visible: boolean) {
    this.depthTag.hidden = !visible;
    if (!visible) return;
    const t = `translate(${Math.round(x) + 14}px, ${Math.round(y) - 22}px)`;
    if (this.depthTag.style.transform !== t) this.depthTag.style.transform = t;
    txt(this.depthTag, text);
  }

  flashWarning(text: string) {
    this.live.warnText.textContent = text;
    this.warnEl.classList.remove("show");
    void this.warnEl.offsetWidth; // restart CSS animation
    this.warnEl.classList.add("show");
  }

  toast(text: string, kind: "ok" | "err" = "ok") {
    this.toastEl.textContent = text;
    this.toastEl.dataset.kind = kind;
    this.toastEl.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove("show"), 2600);
  }
}
