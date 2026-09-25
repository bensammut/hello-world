import { TOOLS, type CameraPresetName, type ToolId } from "../config";

export type MachineStatus = "READY" | "CUTTING" | "TRAVEL" | "TOOL CHANGE" | "COLLISION";

export interface AppState {
  toolId: ToolId;
  /** Diameter index per tool, so each tool remembers its own size. */
  diameterIndex: Record<ToolId, number>;
  depth: number; // mm below stock top
  rpm: number; // commanded
  feed: number; // mm/min
  plungeMode: boolean;
  soundOn: boolean;
  helpOpen: boolean;
  camera: CameraPresetName | null;
  status: MachineStatus;
  stats: { removedMm3: number; cutTime: number; toolChanges: number; strokes: number };
  undoDepth: number;
  redoDepth: number;
}

type Listener = (s: AppState) => void;

/** Tiny observable store: UI subscribes, everything else writes through set(). */
export class Store {
  readonly state: AppState;
  private listeners = new Set<Listener>();

  constructor() {
    const first = TOOLS[0];
    this.state = {
      toolId: first.id,
      diameterIndex: Object.fromEntries(TOOLS.map((t) => [t.id, t.defaultDiameter])) as Record<ToolId, number>,
      depth: 1.5,
      rpm: first.rpm,
      feed: first.feed,
      plungeMode: false,
      soundOn: false,
      helpOpen: false,
      camera: "iso",
      status: "READY",
      stats: { removedMm3: 0, cutTime: 0, toolChanges: 0, strokes: 0 },
      undoDepth: 0,
      redoDepth: 0,
    };
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  set(patch: Partial<AppState>) {
    Object.assign(this.state, patch);
    this.emit();
  }

  emit() {
    for (const fn of this.listeners) fn(this.state);
  }
}
