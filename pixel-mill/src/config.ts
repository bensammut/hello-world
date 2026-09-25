// Single source of truth for tunables: grid, palette, tool specs, machine layout.

export const VOXEL_MM = 0.5;
export const CHUNK = 16;

/** Default stock size in voxels (x = width, y = height, z = depth). */
export const DEFAULT_GRID = { x: 128, y: 48, z: 96 };
/** Upper bound for "New stock" so meshing stays fast. */
export const MAX_GRID = { x: 200, y: 80, z: 160 };
export const MIN_GRID = { x: 16, y: 8, z: 16 };

export const PIXEL = {
  /** The 3D view is rendered at roughly this many rows, then upscaled by an integer factor. */
  targetRows: 180,
  dither: 0.045,
  outline: true,
};

export const UNDO_LIMIT = 24;
export const CHIP_PILE_MAX = 5000;
export const FLYING_CHIPS_MAX = 1600;
export const MIST_MAX = 700;
/** Per-frame time budget for remeshing dirty chunks. */
export const MESH_BUDGET_MS = 7;

// ---------------------------------------------------------------------------
// Palette: 32 colours shared by the 3D post-process (quantisation) and the UI.
// ---------------------------------------------------------------------------
export const PALETTE: readonly string[] = [
  "#0b0d12", "#151923", "#1f2430", "#2a303e", "#363d4d", "#444c5e", "#545d71", "#667086",
  "#79849b", "#8e99b0", "#a3adc2", "#b8c1d3", "#ccd4e2", "#dfe5ef", "#eef2f8", "#ffffff",
  "#f6a33c", "#c26a1c", "#6e3b12", "#ffe07a", "#8cff6e", "#3fbf4f", "#1d6630", "#ff5a4e",
  "#a3212e", "#7fdcff", "#3a93d8", "#1f4f8c", "#7fc8b8", "#3e7f78", "#c792ff", "#6a3fa8",
];

export const COLORS = {
  stock: "#a3adc2",
  stockCut: "#e4eaf3",
  background: "#151923",
  cabinet: "#2a303e",
  cabinetDark: "#1f2430",
  table: "#545d71",
  tableSlot: "#1f2430",
  rail: "#8e99b0",
  gantry: "#363d4d",
  gantryLight: "#444c5e",
  accent: "#f6a33c",
  accentDark: "#c26a1c",
  spindle: "#667086",
  spindleLight: "#b8c1d3",
  steel: "#8e99b0",
  steelLight: "#ccd4e2",
  steelDark: "#545d71",
  carbide: "#79849b",
  vise: "#1f4f8c",
  viseLight: "#3a93d8",
  jaw: "#79849b",
  glass: "#7fc8b8",
  screen: "#8cff6e",
  red: "#ff5a4e",
  green: "#8cff6e",
  amber: "#f6a33c",
  chip: ["#ffffff", "#eef2f8", "#dfe5ef", "#ccd4e2", "#b8c1d3"],
  mist: ["#7fdcff", "#eef2f8", "#3a93d8"],
  ghost: "#f6a33c",
  ghostIdle: "#c26a1c",
};

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------
export type ToolId = "flat" | "ball" | "vbit" | "drill" | "face" | "engrave";

export interface ToolSpec {
  id: ToolId;
  slot: number; // 1-6, also the keyboard shortcut
  name: string;
  short: string;
  /** Selectable cutting diameters in mm (for V-bit/engraver: max cut width). */
  diameters: number[];
  defaultDiameter: number; // index into diameters
  maxDepth: number; // mm, cutting length limit
  plungeOnly: boolean;
  /** Included cone angle for pointed tools. */
  coneDeg?: number;
  rpm: number;
  feed: number; // mm/min
  flutes: number;
  stickout: number; // mm from spindle nose to tip
  color: string;
  blurb: string;
}

export const TOOLS: ToolSpec[] = [
  {
    id: "flat", slot: 1, name: "FLAT END MILL", short: "FLAT",
    diameters: [2, 4, 6, 10], defaultDiameter: 2, maxDepth: 20, plungeOnly: false,
    rpm: 18000, feed: 2400, flutes: 3, stickout: 38, color: "#7fdcff",
    blurb: "Flat bottom pockets and walls",
  },
  {
    id: "ball", slot: 2, name: "BALL END MILL", short: "BALL",
    diameters: [2, 4, 6, 10], defaultDiameter: 2, maxDepth: 20, plungeOnly: false,
    rpm: 20000, feed: 2100, flutes: 2, stickout: 38, color: "#8cff6e",
    blurb: "Smooth 3D contours",
  },
  {
    id: "vbit", slot: 3, name: "V-BIT CHAMFER", short: "V-BIT",
    diameters: [6, 10, 12], defaultDiameter: 1, maxDepth: 6, plungeOnly: false, coneDeg: 90,
    rpm: 16000, feed: 1800, flutes: 2, stickout: 30, color: "#ffe07a",
    blurb: "Width grows with depth",
  },
  {
    id: "drill", slot: 4, name: "TWIST DRILL", short: "DRILL",
    diameters: [2, 3, 5, 8], defaultDiameter: 2, maxDepth: 24, plungeOnly: true, coneDeg: 118,
    rpm: 9000, feed: 600, flutes: 2, stickout: 42, color: "#ff5a4e",
    blurb: "Plunge-only holes",
  },
  {
    id: "face", slot: 5, name: "FACE MILL", short: "FACE",
    diameters: [16, 20, 25], defaultDiameter: 1, maxDepth: 2, plungeOnly: false,
    rpm: 9000, feed: 3000, flutes: 5, stickout: 24, color: "#c792ff",
    blurb: "Shallow levelling passes",
  },
  {
    id: "engrave", slot: 6, name: "ENGRAVING BIT", short: "ENGRV",
    diameters: [0.5, 1, 1.5], defaultDiameter: 1, maxDepth: 1, plungeOnly: false, coneDeg: 30,
    rpm: 24000, feed: 1500, flutes: 1, stickout: 30, color: "#f6a33c",
    blurb: "Fine lines and lettering",
  },
];

export const TOOL_BY_ID = Object.fromEntries(TOOLS.map((t) => [t.id, t])) as Record<ToolId, ToolSpec>;

export const LIMITS = {
  rpm: { min: 3000, max: 30000, step: 500 },
  feed: { min: 200, max: 6000, step: 100 }, // mm/min
  depthStep: 0.5,
};

// ---------------------------------------------------------------------------
// Machine layout (world units are mm, Y is up, table top at y = 0)
// ---------------------------------------------------------------------------
export const MACHINE = {
  viseFloorY: 14, // stock bottom rests here
  jawHeight: 7, // jaws grip the lowest 7 mm of the stock
  jawThickness: 10,
  safeClearance: 4, // retract height above stock top
  rapidSpeed: 220, // mm/s for non-cutting moves
  plungeFactor: 0.45, // plunge feed as a fraction of feed
  travelMargin: 26, // how far past the stock edges the tool may travel
  rack: { slotSpacing: 36, shelfY: 50, gapFromStock: 40, ringHeight: 5 },
  gantryOffsetZ: 51, // beam centre sits this far behind the spindle axis
  enclosure: { halfX: 240, halfZ: 205, top: 300, bottom: -30 },
  toolChangeRapid: 380, // mm/s during the automatic tool change
};

export const CAMERA_PRESETS = {
  top: { theta: 0, phi: 0.02, radius: 170, lift: 0, back: 0 },
  front: { theta: 0, phi: 1.3, radius: 190, lift: 6, back: 0 },
  side: { theta: Math.PI / 2, phi: 1.3, radius: 200, lift: 6, back: 0 },
  // Iso looks slightly behind the stock so tool changes at the rack stay in frame.
  iso: { theta: Math.PI / 4.2, phi: 0.98, radius: 300, lift: 14, back: 22 },
} as const;
export type CameraPresetName = keyof typeof CAMERA_PRESETS;

export const STOCK_PRESETS: { name: string; mm: [number, number, number] }[] = [
  { name: "BLOCK", mm: [64, 24, 48] },
  { name: "PLATE", mm: [90, 10, 70] },
  { name: "CUBE", mm: [40, 36, 40] },
  { name: "BAR", mm: [96, 16, 30] },
];
