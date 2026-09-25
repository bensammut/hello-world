// 16-segment display drawn as SVG, in the style of a dotted LED/VFD character display: each
// segment is a dim bar with a row of bright beads on top. Unlit segments stay faintly visible.
// Colours come from CSS (.seg .bar / .bead, with .on for lit).

const NS = "http://www.w3.org/2000/svg";

// Cell is 12 x 20 units. Top (a) and bottom (d) bars are split in two, as on 16-segment displays.
const SEGS: Record<string, [number, number, number, number]> = {
  a1: [1.9, 1, 5.3, 1], a2: [6.7, 1, 10.1, 1], b: [11, 2.2, 11, 8.8], c: [11, 11.2, 11, 17.8],
  d1: [1.9, 19, 5.3, 19], d2: [6.7, 19, 10.1, 19], e: [1, 11.2, 1, 17.8], f: [1, 2.2, 1, 8.8],
  g1: [2.2, 10, 5, 10], g2: [7, 10, 9.8, 10],
  h: [2.8, 2.8, 5, 8.2], i: [6, 2.2, 6, 8.8], j: [9.2, 2.8, 7, 8.2],
  k: [5, 11.8, 2.8, 17.2], l: [6, 11.2, 6, 17.8], m: [7, 11.8, 9.2, 17.2],
};

// "a" and "d" light both halves.
const CHARS: Record<string, string> = {
  "0": "a b c d e f j k", "1": "b c j", "2": "a b g1 g2 e d", "3": "a b c d g2", "4": "f g1 g2 b c",
  "5": "a f g1 g2 c d", "6": "a f e d c g1 g2", "7": "a b c", "8": "a b c d e f g1 g2",
  "9": "a b c d f g1 g2", "-": "g1 g2", "+": "g1 g2 i l", " ": "",
  A: "a b c e f g1 g2", C: "a d e f", D: "a b c d i l", E: "a d e f g1", L: "d e f",
  O: "a b c d e f", P: "a b e f g1 g2", R: "a b e f g1 g2 m", T: "a i l",
};

function litSet(ch: string) {
  const out = new Set<string>();
  for (const s of (CHARS[ch] ?? "").split(" ")) {
    if (s === "a" || s === "d") {
      out.add(s + "1");
      out.add(s + "2");
    } else if (s) out.add(s);
  }
  return out;
}

const PITCH = 15;

export class SegDisplay {
  readonly el: SVGSVGElement;
  private cells: { segs: Map<string, SVGGElement>; dot: SVGCircleElement }[] = [];
  private text = "";

  /** `cells` characters wide; `height` in CSS px. */
  constructor(cells: number, height: number) {
    const w = cells * PITCH + 1;
    this.el = document.createElementNS(NS, "svg");
    this.el.setAttribute("class", "seg");
    this.el.setAttribute("viewBox", `0 0 ${w} 21`);
    this.el.setAttribute("height", String(height));
    this.el.setAttribute("width", ((height * w) / 21).toFixed(1));
    for (let n = 0; n < cells; n++) {
      const ox = n * PITCH + 1.5;
      const segs = new Map<string, SVGGElement>();
      for (const [name, [x1, y1, x2, y2]] of Object.entries(SEGS)) {
        const g = document.createElementNS(NS, "g");
        for (const cls of ["bar", "bead"]) {
          const line = document.createElementNS(NS, "line");
          line.setAttribute("class", cls);
          line.setAttribute("x1", String(x1 + ox));
          line.setAttribute("y1", String(y1 + 0.5));
          line.setAttribute("x2", String(x2 + ox));
          line.setAttribute("y2", String(y2 + 0.5));
          g.appendChild(line);
        }
        this.el.appendChild(g);
        segs.set(name, g);
      }
      const dot = document.createElementNS(NS, "circle");
      dot.setAttribute("cx", String(ox + 12.4));
      dot.setAttribute("cy", "19.5");
      dot.setAttribute("r", "1.1");
      this.el.appendChild(dot);
      this.cells.push({ segs, dot });
    }
  }

  /** A "." lights the dot of the previous character. Text is right-aligned into the cells. */
  set(text: string) {
    if (text === this.text) return;
    this.text = text;
    const chars: { ch: string; dot: boolean }[] = [];
    for (const ch of text.toUpperCase()) {
      if (ch === "." && chars.length) chars[chars.length - 1].dot = true;
      else chars.push({ ch, dot: false });
    }
    const pad = this.cells.length - chars.length;
    this.cells.forEach((cell, n) => {
      const c = chars[n - pad];
      const lit = c ? litSet(c.ch) : new Set<string>();
      for (const [name, g] of cell.segs) g.classList.toggle("on", lit.has(name));
      cell.dot.classList.toggle("on", !!c?.dot);
    });
  }
}
