// 14-segment display drawn as SVG lines. Unlit segments stay visible (ghosted), like the
// K.O. II glass; lit segments get the "on" class. Colours come from CSS (.seg line / .on).

const NS = "http://www.w3.org/2000/svg";

// Cell is 12 x 20 units.
const SEGS: Record<string, [number, number, number, number]> = {
  a: [2.2, 1, 9.8, 1], b: [11, 2.2, 11, 8.8], c: [11, 11.2, 11, 17.8], d: [2.2, 19, 9.8, 19],
  e: [1, 11.2, 1, 17.8], f: [1, 2.2, 1, 8.8], g1: [2.2, 10, 5, 10], g2: [7, 10, 9.8, 10],
  h: [2.8, 2.8, 5, 8.2], i: [6, 2.2, 6, 8.8], j: [9.2, 2.8, 7, 8.2],
  k: [5, 11.8, 2.8, 17.2], l: [6, 11.2, 6, 17.8], m: [7, 11.8, 9.2, 17.2],
};

const CHARS: Record<string, string[]> = {
  "0": ["a", "b", "c", "d", "e", "f"], "1": ["b", "c"], "2": ["a", "b", "g1", "g2", "e", "d"],
  "3": ["a", "b", "c", "d", "g2"], "4": ["f", "g1", "g2", "b", "c"], "5": ["a", "f", "g1", "g2", "c", "d"],
  "6": ["a", "f", "e", "d", "c", "g1", "g2"], "7": ["a", "b", "c"], "8": ["a", "b", "c", "d", "e", "f", "g1", "g2"],
  "9": ["a", "b", "c", "d", "f", "g1", "g2"], "-": ["g1", "g2"], "+": ["g1", "g2", "i", "l"], " ": [],
  A: ["a", "b", "c", "e", "f", "g1", "g2"], C: ["a", "d", "e", "f"], D: ["a", "b", "c", "d", "i", "l"],
  E: ["a", "d", "e", "f", "g1"], L: ["d", "e", "f"], O: ["a", "b", "c", "d", "e", "f"],
  P: ["a", "b", "e", "f", "g1", "g2"], R: ["a", "b", "e", "f", "g1", "g2", "m"], T: ["a", "i", "l"],
};

const PITCH = 15;

export class SegDisplay {
  readonly el: SVGSVGElement;
  private cells: { segs: Map<string, SVGLineElement>; dot: SVGCircleElement }[] = [];
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
      const segs = new Map<string, SVGLineElement>();
      for (const [name, [x1, y1, x2, y2]] of Object.entries(SEGS)) {
        const line = document.createElementNS(NS, "line");
        line.setAttribute("x1", String(x1 + ox));
        line.setAttribute("y1", String(y1 + 0.5));
        line.setAttribute("x2", String(x2 + ox));
        line.setAttribute("y2", String(y2 + 0.5));
        this.el.appendChild(line);
        segs.set(name, line);
      }
      const dot = document.createElementNS(NS, "circle");
      dot.setAttribute("cx", String(ox + 12.4));
      dot.setAttribute("cy", "19.5");
      dot.setAttribute("r", "1.4");
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
      const lit = new Set(c ? CHARS[c.ch] ?? [] : []);
      for (const [name, line] of cell.segs) line.classList.toggle("on", lit.has(name));
      cell.dot.classList.toggle("on", !!c?.dot);
    });
  }
}
