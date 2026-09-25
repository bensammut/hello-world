import { COLORS, PALETTE, TOOLS, type ToolId } from "../config";

/**
 * Android app only (imported by main.android.ts): retune the 3D scene to the K.O.-style control
 * surface. Must be imported before anything that reads COLORS / PALETTE at module load.
 */

// Warm-grey ramp, a few cool greys that read as aluminium, and the display's accent colours.
const KO_PALETTE = [
  "#0b0b0b", "#161615", "#222221", "#2e2e2c", "#3b3b39", "#4a4a47", "#5b5b58", "#6e6e6a",
  "#83837e", "#989893", "#adada8", "#c2c2bd", "#d6d6d1", "#e8e8e3", "#f4f4f0", "#ffffff",
  "#7f8488", "#9a9fa3", "#b4b9bc", "#cfd3d5",
  "#2f73b5", "#7fb4e2", "#1c4a7a", "#e03c2c", "#9e2a1f",
  "#5b93bd", "#8db7d6", "#3b6687", "#c24a8e", "#8a3363", "#d9a07a", "#a8764f",
];

const KO_COLORS: Partial<typeof COLORS> = {
  stock: "#9a9fa3", // cool aluminium, apart from the warm machine greys
  stockCut: "#eef0f1",
  background: "#e8e8e3",
  skyLight: "#f4f4f0",
  groundLight: "#6e6e6a",
  keyLight: "#ffffff",
  rimLight: "#f4f4f0",
  cabinet: "#d6d6d1",
  cabinetDark: "#c2c2bd",
  table: "#3b3b39",
  tableSlot: "#161615",
  rail: "#83837e",
  gantry: "#d6d6d1",
  gantryLight: "#c2c2bd",
  accent: "#2f73b5",
  accentDark: "#1c4a7a",
  spindle: "#2e2e2c",
  spindleLight: "#5b5b58",
  steel: "#989893",
  steelLight: "#d6d6d1",
  steelDark: "#4a4a47",
  carbide: "#6e6e6a",
  vise: "#222221",
  viseLight: "#4a4a47",
  jaw: "#989893",
  glass: "#f4f4f0",
  screen: "#2f73b5",
  red: "#e03c2c",
  green: "#f4f4f0",
  amber: "#2f73b5",
  chip: ["#ffffff", "#f4f4f0", "#cfd3d5", "#b4b9bc", "#9a9fa3"],
  mist: ["#8db7d6", "#f4f4f0", "#5b93bd"],
  ghost: "#7fb4e2",
  ghostIdle: "#2f73b5",
};

// Rack rings take the display's block colours, so each tool's key and ring share a colour.
const KO_TOOL_COLORS: Record<ToolId, string> = {
  flat: "#2f73b5",
  ball: "#8db7d6",
  vbit: "#d9a07a",
  drill: "#e03c2c",
  face: "#c24a8e",
  engrave: "#f4f4f0",
};

Object.assign(COLORS, KO_COLORS);
(PALETTE as string[]).splice(0, PALETTE.length, ...KO_PALETTE);
for (const t of TOOLS) t.color = KO_TOOL_COLORS[t.id];
