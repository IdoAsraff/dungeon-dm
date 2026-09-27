import { create } from "zustand";
import type { EntityKind, EntityRef, PlayerRotation } from "../types";

export type DrawTool = "box" | "circle" | "freeform" | "polygon";

/** What a finished drawing will be used for. */
export type DrawPurpose =
  | { type: "create"; kind: EntityKind }
  | { type: "reshape"; target: EntityRef };

export interface DrawMode {
  tool: DrawTool;
  purpose: DrawPurpose;
}

export type Dialog =
  | { type: "addLevel" }
  | { type: "editLevel"; levelId: string }
  | { type: "levelDescription"; levelId: string }
  | { type: "background" };

/** The player window's viewport as reported by the player window. */
export interface PlayerViewport {
  levelId: string | null;
  x: number;
  y: number;
  scale: number;
  rotation: PlayerRotation;
  width: number;
  height: number;
}

interface UiState {
  dungeonDir: string | null;
  currentLevelId: string | null;
  selection: EntityRef | null;
  hover: EntityRef | null;
  draw: DrawMode | null;
  /** Vertex-editing mode for the selected entity. */
  editingShape: boolean;
  snap: number;
  dialog: Dialog | null;
  toast: { id: number; text: string } | null;
  playerViewport: PlayerViewport | null;
  saveStatus: "saved" | "saving" | "error";
  saveError: string | null;
  /** Ask the DM map to zoom to an entity (nonce makes repeated requests distinct). */
  zoomRequest: { target: EntityRef; nonce: number } | null;
  /** Room whose title field should grab focus (set right after drawing a new room). */
  focusTitleFor: string | null;

  set: (patch: Partial<Omit<UiState, "set" | "showToast">>) => void;
  showToast: (text: string) => void;
}

export const useUi = create<UiState>()((set) => ({
  dungeonDir: null,
  currentLevelId: null,
  selection: null,
  hover: null,
  draw: null,
  editingShape: false,
  snap: 1,
  dialog: null,
  toast: null,
  playerViewport: null,
  saveStatus: "saved",
  saveError: null,
  zoomRequest: null,
  focusTitleFor: null,
  set: (patch) => set(patch),
  showToast: (text) => set({ toast: { id: Date.now(), text } }),
}));
