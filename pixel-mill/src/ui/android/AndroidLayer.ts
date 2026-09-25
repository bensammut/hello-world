import { TOOL_BY_ID } from "../../config";
import type { AppState, Store } from "../../state/store";
import { toolPictogram } from "./pictograms";
import { SegDisplay } from "./seg14";

/**
 * Android control surface. Builds K.O.-style rails, a segment display and one slide-out sheet,
 * and moves the existing UI controls into them, so every data-act / data-live / data-tool /
 * data-cam hook and UI.ts binding keeps working. Old desktop panels are hidden by android.css.
 */
export function mountAndroidLayer(store: Store) {
  const ui = document.getElementById("ui")!;
  const q = <T extends Element = HTMLElement>(sel: string) => ui.querySelector(sel) as T;
  const liveText = (key: string) => q(`[data-live="${key}"]`)?.textContent ?? "";

  const root = document.createElement("div");
  root.className = "ko";
  root.innerHTML = `
    <div class="ko-top ko-lcd"><div data-ko="status-top"></div></div>
    <aside class="ko-rail ko-left">
      <div class="ko-brand">PM–3</div>
      <div class="ko-tools"></div>
    </aside>
    <aside class="ko-rail ko-right">
      <div class="ko-lcd ko-depth">
        <div class="ko-row" data-ko="status"></div>
        <div class="ko-big"><span data-ko="depth"></span><span class="ko-unit">MM</span></div>
        <div class="ko-row"><span class="ko-blk tool" data-ko="tool">FLAT</span><span data-ko="dia"></span><span class="ko-grow"></span><span data-ko="rpm"></span></div>
      </div>
      <div class="ko-silk">DEPTH</div>
      <button class="ko-key" data-act="depth-" data-ko="k-up">UP</button>
      <button class="ko-key" data-act="depth+" data-ko="k-down">DOWN</button>
      <div class="ko-silk">TOOL</div>
      <button class="ko-key" data-act="retract" data-ko="k-retract">RETRACT</button>
      <button class="ko-key" data-act="plunge" data-ko="k-plunge">PLUNGE</button>
      <button class="ko-key" data-act="dia-" data-ko="k-dia-">Ø –</button>
      <button class="ko-key" data-act="dia+" data-ko="k-dia+">Ø +</button>
      <button class="ko-key" data-act="undo" data-ko="k-undo">UNDO <span class="ko-count" data-ko="undo">0</span></button>
      <button class="ko-key" data-ko="k-more">MORE</button>
    </aside>
    <div class="ko-scrim" hidden></div>
    <section class="ko-rail ko-sheet" aria-label="More controls">
      <div class="ko-grab"></div>
      <div class="ko-lcd ko-dro">
        <span class="k">X</span><span data-ko="x"></span><span class="k">S</span><span data-ko="s"></span>
        <span class="k">Y</span><span data-ko="y"></span><span class="k">F</span><span data-ko="f"></span>
        <span class="k">Z</span><span data-ko="z"></span><span class="k">W</span><span data-ko="w"></span>
      </div>
      <div class="ko-faders"></div>
      <div class="ko-silk">VIEW</div>
      <div class="ko-grid ko-cams"></div>
      <div class="ko-silk">FILE</div>
      <div class="ko-grid ko-files"></div>
      <div class="ko-silk">MACHINE</div>
      <div class="ko-grid ko-misc"></div>
      <div class="ko-silk">JOB</div>
      <div class="ko-stats"></div>
    </section>`;
  ui.appendChild(root);
  const $ = (k: string) => root.querySelector(`[data-ko="${k}"]`) as HTMLElement;

  // Tool keys: reuse the existing .slot buttons (UI.ts toggles .active and handles data-tool clicks).
  const tools = root.querySelector(".ko-tools")!;
  for (const b of ui.querySelectorAll<HTMLElement>(".magazine .slot")) {
    const t = TOOL_BY_ID[b.dataset.tool as keyof typeof TOOL_BY_ID];
    b.classList.add("ko-key", "ko-tool");
    b.innerHTML = `<span class="n">${t.slot}</span>${toolPictogram(t.id, t.color)}<span class="nm">${t.short}</span>`;
    b.title = `${t.name} (key ${t.slot})`;
    tools.appendChild(b);
  }

  // Sheet contents: existing sliders, camera presets, file/menu buttons and job stats move in.
  const faders = root.querySelector(".ko-faders")!;
  for (const s of ui.querySelectorAll<HTMLElement>(".hud .slider:not(.depth)")) faders.appendChild(s);
  const cams = root.querySelector(".ko-cams")!;
  for (const b of ui.querySelectorAll<HTMLElement>(".cams [data-cam]")) {
    b.classList.add("ko-key");
    cams.appendChild(b);
  }
  const files = root.querySelector(".ko-files")!;
  for (const act of ["new", "open", "save", "stl"]) {
    const b = q(`.topbar [data-act="${act}"]`);
    b.classList.add("ko-key");
    files.appendChild(b);
  }
  const misc = root.querySelector(".ko-misc")!;
  for (const sel of ['.topbar [data-act="redo"]', '.hud [data-act="blow"]', '.topbar [data-act="sound"]', '.topbar [data-act="help"]']) {
    const b = q(sel);
    b.classList.add("ko-key");
    b.querySelector("svg")?.remove();
    misc.appendChild(b);
  }
  // HardwareController injects its button into #ui. Keep it one tap away: bottom of the right rail
  // in landscape, right end of the status strip in portrait. It lights up (accent) while connected.
  const pendant = document.getElementById("pendant-btn");
  if (pendant) {
    pendant.removeAttribute("style");
    pendant.classList.add("ko-key", "ko-pendant");
    pendant.dataset.ko = "k-pendant";
    const rail = root.querySelector(".ko-right")!;
    const top = root.querySelector(".ko-top")!;
    const portrait = matchMedia("(orientation: portrait)");
    const place = () => (portrait.matches ? top : rail).appendChild(pendant);
    portrait.addEventListener("change", place);
    place();
    const sync = () => pendant.classList.toggle("on", /ON$/.test(pendant.textContent ?? ""));
    new MutationObserver(sync).observe(pendant, { childList: true, characterData: true, subtree: true });
    sync();
  }
  const stats = root.querySelector(".ko-stats")!;
  const statsTable = q(".stats table");
  if (statsTable) stats.appendChild(statsTable);

  // Segment displays.
  const seg = {
    depth: new SegDisplay(5, 40), dia: new SegDisplay(4, 13), rpm: new SegDisplay(5, 13),
    x: new SegDisplay(6, 16), y: new SegDisplay(6, 16), z: new SegDisplay(6, 16),
    s: new SegDisplay(5, 16), f: new SegDisplay(5, 16), w: new SegDisplay(5, 16),
  };
  for (const [k, d] of Object.entries(seg)) $(k).replaceWith(d.el);

  // MORE sheet.
  const sheet = root.querySelector(".ko-sheet") as HTMLElement;
  const scrim = root.querySelector(".ko-scrim") as HTMLElement;
  const setSheet = (open: boolean) => {
    sheet.classList.toggle("open", open);
    scrim.hidden = !open;
    $("k-more").classList.toggle("on", open);
  };
  $("k-more").addEventListener("click", () => setSheet(!sheet.classList.contains("open")));
  scrim.addEventListener("pointerdown", () => setSheet(false));
  root.querySelector(".ko-grab")!.addEventListener("click", () => setSheet(false));

  // State rendering.
  let lastStatus = "";
  const statusHtml = (state: string, detail: string, compact: boolean) => {
    switch (state) {
      case "CUTTING": return `<span class="ko-dot"></span><span>CUT</span>`;
      case "TRAVEL": return `<span class="ko-dot off"></span><span>MOVE</span>`;
      case "TOOL CHANGE": return `<span class="ko-blk change ko-blink">TOOL</span><span>${detail.replace(/[^0-9]/g, "") || ""}%</span>`;
      case "COLLISION": return `<span class="ko-blk out ko-blink">VISE</span>${compact ? "" : "<span class=\"ko-red\">COLLISION</span>"}`;
      default: return `<span class="ko-dot off"></span><span class="ko-blk white">READY</span>`;
    }
  };

  const num = (text: string) => parseFloat(text.replace(/[^0-9+\-.]/g, "")) || 0;
  const signed = (v: number, d: number, w: number) => `${v < 0 ? "-" : "+"}${Math.abs(v).toFixed(d).padStart(w, "0")}`;

  const render = (s: AppState) => {
    const tool = TOOL_BY_ID[s.toolId];
    const dia = tool.diameters[s.diameterIndex[s.toolId]];
    seg.depth.set(`-${s.depth.toFixed(1).padStart(4, "0")}`);
    seg.dia.set(dia.toFixed(1).padStart(4, "0"));
    $("tool").textContent = tool.short;
    $("tool").style.background = tool.color;
    $("undo").textContent = String(s.undoDepth);
    $("k-plunge").classList.toggle("on", s.plungeMode);
    const plunge = s.plungeMode || tool.plungeOnly;
    const statusDetail = liveText("status");
    const key = `${s.status}|${statusDetail}|${plunge}|${tool.slot}`;
    if (key !== lastStatus) {
      lastStatus = key;
      const extra = `<span class="ko-grow"></span><span class="ko-blk ${plunge ? "accent" : "ghost"}">${tool.plungeOnly ? "DRILL" : "PLUNGE"}</span><span class="ko-blk white">T${tool.slot}</span>`;
      $("status").innerHTML = statusHtml(s.status, statusDetail, true) + extra;
      $("status-top").innerHTML = `<div class="ko-row">${statusHtml(s.status, statusDetail, false)}<span class="ko-blk tool" style="background:${tool.color}">${tool.short}</span>${extra}</div>`;
    }
  };
  store.subscribe(render);
  store.emit(); // re-apply UI.ts state (e.g. the active tool) to the moved elements

  // Per-frame readouts are already written into the (hidden) desktop DRO; mirror them at 10 Hz.
  setInterval(() => {
    const s = store.state;
    render(s);
    seg.x.set(signed(num(liveText("x")), 2, 5));
    seg.y.set(signed(num(liveText("y")), 2, 5));
    seg.z.set(signed(num(liveText("z")), 2, 5));
    const rpm = Math.round(num(liveText("rpm")));
    seg.rpm.set(String(rpm).padStart(5, " "));
    seg.s.set(String(rpm).padStart(5, " "));
    seg.f.set(String(Math.round(num(liveText("feed")))).padStart(5, " "));
    seg.w.set(num(liveText("width")).toFixed(2).padStart(5, "0"));
  }, 100);

}
