/** UI state of the Combat tab (not saved with the dungeon). */
import { create } from "zustand";

export type InspectorTarget =
  | { kind: "combatant"; id: string; /** condition id to highlight */ condition?: string }
  | { kind: "condition"; id: string }
  | { kind: "quickref"; section: string; index: number };

const CHEAT_KEY = "combat.cheatsheet";

function loadCheat(): boolean {
  try {
    return localStorage.getItem(CHEAT_KEY) !== "0";
  } catch {
    return true;
  }
}

interface CombatUiState {
  inspect: InspectorTarget | null;
  cheatOpen: boolean;
  set: (p: Partial<Omit<CombatUiState, "set">>) => void;
}

export const useCombatUi = create<CombatUiState>()((set) => ({
  inspect: null,
  cheatOpen: loadCheat(),
  set: (p) => {
    set(p);
    if (p.cheatOpen !== undefined) {
      try {
        localStorage.setItem(CHEAT_KEY, p.cheatOpen ? "1" : "0");
      } catch {
        /* ignore */
      }
    }
  },
}));

export const inspectCombatant = (id: string, condition?: string) => useCombatUi.getState().set({ inspect: { kind: "combatant", id, condition } });
