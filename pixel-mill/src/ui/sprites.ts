import type { ToolId } from "../config";

// Sprites are character grids; each character maps to a colour. '.' is transparent.
// 'h' is replaced by the sprite's accent colour so tool icons match their rack ring.
const BASE_COLORS: Record<string, string> = {
  k: "#0b0d12",
  s: "#eef2f8",
  m: "#a3adc2",
  d: "#667086",
  y: "#ffe07a",
  a: "#f6a33c",
  g: "#8cff6e",
  r: "#ff5a4e",
  b: "#7fdcff",
  w: "#ffffff",
};

const HOLDER = ["..kkkkkkkk..", "..khhhhhhk..", "..kkkkkkkk.."];

const TOOL_SPRITES: Record<ToolId, string[]> = {
  flat: [
    ...HOLDER,
    "...kmssdk...", "...kmssdk...", "...kmssdk...",
    "...ksmdsk...", "...kdsmsk...", "...ksmdsk...", "...kdsmsk...",
    "...ksmdsk...", "...kdsmsk...", "...ksmdsk...", "...kkkkkk...",
    "............", "............",
  ],
  ball: [
    ...HOLDER,
    "...kmssdk...", "...kmssdk...", "...kmssdk...",
    "...ksmdsk...", "...kdsmsk...", "...ksmdsk...", "...kdsmsk...",
    "...ksmdsk...", "...kdsmsk...", "....kddk....", ".....kk.....",
    "............", "............",
  ],
  vbit: [
    ...HOLDER,
    "....kmsk....", "....kmsk....", "....kmsk....", "....kmsk....",
    "..kkkkkkkk..", "..kssmmddk..", "...ksmmdk...", "....ksdk....", ".....kk.....",
    "............", "............", "............", "............",
  ],
  drill: [
    ...HOLDER,
    "....kmsk....", "....ksdk....", "....kmsk....", "....kdsk....",
    "....kmsk....", "....ksdk....", "....kmsk....", "....kdsk....",
    "....kmsk....", "....ksdk....", ".....kk.....",
    "............", "............",
  ],
  face: [
    ...HOLDER,
    "....kmsk....", "....kmsk....",
    "kkkkkkkkkkkk", "kmssssssssdk", "kmsssmmsssdk", "kyddyddyddyk", "kkkkkkkkkkkk",
    "............", "............", "............", "............", "............", "............",
  ],
  engrave: [
    ...HOLDER,
    "....kmsk....", "....kmsk....", "....kmsk....", "....kmsk....",
    "....kmsk....", "....ksdk....", ".....kk.....", ".....kk.....", ".....kk.....", "......k.....",
    "............", "............", "............",
  ],
};

export const ICONS: Record<string, string[]> = {
  speakerOn: [
    "....k.......", "...kk...a...", "kkkmk..a.a..", "kssmk....a..",
    "kssmk.a..a..", "kssmk....a..", "kkkmk..a.a..", "...kk...a...", "....k.......",
  ],
  speakerOff: [
    "....k.......", "...kk.......", "kkkmk.r...r.", "kssmk..r.r..",
    "kssmk...r...", "kssmk..r.r..", "kkkmk.r...r.", "...kk.......", "....k.......",
  ],
  logo: [
    "..kkkkkkkk..", "..kaaaaaak..", "..kkkkkkkk..", "....kmsk....",
    "....ksdk....", "....kmsk....", ".....kk.....", "............",
    "k.k.k.k.k.k.", "kmmmmmmmmmmk", "kddddddddddk", "kkkkkkkkkkkk",
  ],
  blower: [
    "kkkkk.......", "kmssk..b.b..", "kmsskkb.b.b.", "kmsssss.b.b.",
    "kmsskkb.b.b.", "kmssk..b.b..", "kkkkk.......", "..kk........", "..kk........",
  ],
};

export function spriteSvg(rows: string[], scale: number, accent = "#f6a33c"): string {
  const h = rows.length;
  const w = rows[0].length;
  let rects = "";
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      if (ch === "." || ch === undefined) continue;
      const fill = ch === "h" ? accent : BASE_COLORS[ch];
      if (fill) rects += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${fill}"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w * scale}" height="${h * scale}" shape-rendering="crispEdges">${rects}</svg>`;
}

export function toolIcon(id: ToolId, accent: string, scale = 3) {
  return spriteSvg(TOOL_SPRITES[id], scale, accent);
}
