import { MAX_GRID, MIN_GRID, TOOL_BY_ID, VOXEL_MM, type ToolId } from "../config";
import type { AppState } from "../state/store";
import { VoxelGrid, type Dims } from "../voxel/VoxelGrid";

const FORMAT = "pixel-mill-project";

interface ProjectFile {
  format: typeof FORMAT;
  version: 1;
  savedAt: string;
  voxelMm: number;
  dims: Dims;
  encoding: "deflate-raw+base64";
  voxels: string;
  settings: Pick<AppState, "toolId" | "diameterIndex" | "depth" | "rpm" | "feed" | "plungeMode">;
  stats: AppState["stats"];
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

function toBase64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function serializeProject(grid: VoxelGrid, state: AppState) {
  const packed = await pipe(grid.data, new CompressionStream("deflate-raw"));
  const file: ProjectFile = {
    format: FORMAT,
    version: 1,
    savedAt: new Date().toISOString(),
    voxelMm: VOXEL_MM,
    dims: grid.dims,
    encoding: "deflate-raw+base64",
    voxels: toBase64(packed),
    settings: {
      toolId: state.toolId,
      diameterIndex: state.diameterIndex,
      depth: state.depth,
      rpm: state.rpm,
      feed: state.feed,
      plungeMode: state.plungeMode,
    },
    stats: state.stats,
  };
  return { json: JSON.stringify(file), packedBytes: packed.length, ratio: packed.length / grid.data.length };
}

export async function saveProject(grid: VoxelGrid, state: AppState) {
  const out = await serializeProject(grid, state);
  downloadBlob(new Blob([out.json], { type: "application/json" }), "pixel-mill-part.json");
  return out;
}

export interface LoadedProject {
  grid: VoxelGrid;
  settings: ProjectFile["settings"];
  stats: ProjectFile["stats"];
}

export function loadProject(file: File): Promise<LoadedProject> {
  return file.text().then(parseProject);
}

export async function parseProject(text: string): Promise<LoadedProject> {
  const json = JSON.parse(text) as Partial<ProjectFile>;
  if (json.format !== FORMAT || json.version !== 1) throw new Error("Not a PIXEL MILL project file");
  const d = json.dims;
  if (
    !d || !json.voxels ||
    d.x < MIN_GRID.x || d.y < MIN_GRID.y || d.z < MIN_GRID.z ||
    d.x > MAX_GRID.x || d.y > MAX_GRID.y || d.z > MAX_GRID.z
  )
    throw new Error("Unsupported stock size in file");
  const bytes = await pipe(fromBase64(json.voxels), new DecompressionStream("deflate-raw"));
  const grid = new VoxelGrid(d);
  if (bytes.length !== grid.data.length) throw new Error("Voxel data is corrupt");
  for (let i = 0; i < bytes.length; i++) if (bytes[i] > 2) throw new Error("Voxel data is corrupt");
  grid.data.set(bytes);
  grid.markAllDirty();

  const s = json.settings;
  const toolId: ToolId = s && s.toolId in TOOL_BY_ID ? s.toolId : "flat";
  return {
    grid,
    settings: {
      toolId,
      diameterIndex: { ...(s?.diameterIndex ?? {}) } as ProjectFile["settings"]["diameterIndex"],
      depth: Number(s?.depth) || 1,
      rpm: Number(s?.rpm) || TOOL_BY_ID[toolId].rpm,
      feed: Number(s?.feed) || TOOL_BY_ID[toolId].feed,
      plungeMode: !!s?.plungeMode,
    },
    stats: {
      removedMm3: Number(json.stats?.removedMm3) || 0,
      cutTime: Number(json.stats?.cutTime) || 0,
      toolChanges: Number(json.stats?.toolChanges) || 0,
      strokes: Number(json.stats?.strokes) || 0,
    },
  };
}
