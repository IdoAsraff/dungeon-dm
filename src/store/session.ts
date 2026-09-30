import { create } from "zustand";
import { DEFAULT_SESSION, MAX_BRIGHTNESS, MIN_BRIGHTNESS, type CombatCondition, type Combatant, type Focus, type Session } from "../types";
import { newId } from "../lib/ids";
import { nextTurn, previousTurn, type TurnResult } from "../lib/combat";

export type NewCombatant = Omit<Combatant, "id" | "side"> & { side?: Combatant["side"] };

/** A one-shot instruction for where the player window's camera should go. */
export type ViewCommand = { kind: "room"; levelId: string; roomId: string } | { kind: "level"; levelId: string };

/**
 * Per-dungeon runtime state that is saved with the dungeon but not part of
 * the undo history: which room the player window is focused on, which level
 * it shows, and how the DM has set up the player view.
 */
interface SessionState extends Session {
  /** Incremented for every new view command so the player window can tell them apart. */
  viewNonce: number;
  viewCommand: ViewCommand | null;
  setSession: (s: Session) => void;
  focusRoom: (focus: Focus) => void;
  clearFocus: () => void;
  setPlayerLevel: (levelId: string | null) => void;
  /** Clears the focus and zooms the player window out to all known rooms of `levelId`. */
  showWholeLevel: (levelId: string) => void;
  setBlackout: (on: boolean) => void;
  /** Toggles 0° / 90° and re-fits the player view to what it was showing. */
  toggleRotation: () => void;
  setCompass: (on: boolean) => void;
  setBrightness: (brightness: number) => void;
  /** Adds combatants (after the others); returns their ids. */
  addCombatants: (list: NewCombatant[]) => string[];
  updateCombatant: (id: string, patch: Partial<Omit<Combatant, "id">>) => void;
  removeCombatant: (id: string) => void;
  /** Moves a combatant so it ends up at `index` in the list. */
  moveCombatant: (id: string, index: number) => void;
  /** Removes every enemy, keeping the party. */
  clearEnemies: () => void;
  addCondition: (combatantId: string, condition: Omit<CombatCondition, "id">) => void;
  updateCondition: (combatantId: string, conditionId: string, patch: Partial<Omit<CombatCondition, "id">>) => void;
  removeCondition: (combatantId: string, conditionId: string) => void;
  /** Moves the turn marker on; returns what expired. */
  nextTurn: () => TurnResult;
  previousTurn: () => void;
  /** Ends the round count (the list stays). */
  endCombat: () => void;
  /** Stat blocks moved/renamed in Notes: keep combatant links pointing at them. */
  remapStats: (fromPath: string, toPath: string) => void;
  /** Images (dungeon-root-relative paths) shown full-screen to the players, side by side; not saved. */
  handout: string[] | null;
  showHandout: (path: string | null) => void;
  /** Shows several images at once (e.g. all enemies); an empty list hides. */
  showHandouts: (paths: string[]) => void;
}

export const useSession = create<SessionState>()((set, get) => ({
  ...DEFAULT_SESSION,
  viewNonce: 0,
  viewCommand: null,
  handout: null,
  showHandout: (path) => set({ handout: path ? [path] : null }),
  showHandouts: (paths) => set({ handout: paths.length ? paths : null }),
  setSession: (s) => set({ ...DEFAULT_SESSION, ...s, handout: null }),
  focusRoom: (focus) =>
    set((st) => ({
      focus,
      playerLevelId: focus.levelId,
      viewNonce: st.viewNonce + 1,
      viewCommand: { kind: "room", ...focus },
    })),
  clearFocus: () => set({ focus: null }),
  setPlayerLevel: (playerLevelId) => set({ playerLevelId }),
  showWholeLevel: (levelId) =>
    set((st) => ({
      focus: null,
      playerLevelId: levelId,
      viewNonce: st.viewNonce + 1,
      viewCommand: { kind: "level", levelId },
    })),
  setBlackout: (blackout) => set({ blackout }),
  toggleRotation: () => {
    const { rotation, focus, playerLevelId, viewNonce } = get();
    const viewCommand: ViewCommand | null = focus
      ? { kind: "room", ...focus }
      : playerLevelId
        ? { kind: "level", levelId: playerLevelId }
        : null;
    set({ rotation: rotation === 0 ? 90 : 0, viewNonce: viewNonce + 1, viewCommand });
  },
  setCompass: (compass) => set({ compass }),
  setBrightness: (brightness) => set({ brightness: Math.max(MIN_BRIGHTNESS, Math.min(MAX_BRIGHTNESS, brightness)) }),
  addCombatants: (list) => {
    const added = list.map((c) => ({ ...c, id: newId("c"), name: c.name.trim(), hp: Math.round(c.hp), side: c.side ?? ("enemy" as const) }));
    set((s) => ({ combat: [...s.combat, ...added] }));
    return added.map((c) => c.id);
  },
  updateCombatant: (id, patch) => set((s) => ({ combat: s.combat.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
  removeCombatant: (id) =>
    set((s) => {
      const idx = s.combat.findIndex((c) => c.id === id);
      const combat = s.combat.filter((c) => c.id !== id);
      // Removing whoever's turn it is passes the turn to the next in line.
      const turn = s.turn === id ? (combat[idx] ?? combat[0])?.id ?? null : s.turn;
      return { combat, turn };
    }),
  moveCombatant: (id, index) =>
    set((s) => {
      const from = s.combat.findIndex((c) => c.id === id);
      if (from === -1) return {};
      const list = [...s.combat];
      const [item] = list.splice(from, 1);
      list.splice(Math.max(0, Math.min(index, list.length)), 0, item);
      return { combat: list };
    }),
  clearEnemies: () =>
    set((s) => {
      const combat = s.combat.filter((c) => c.side === "party");
      return { combat, turn: combat.some((c) => c.id === s.turn) ? s.turn : null, round: combat.length ? s.round : 0 };
    }),
  addCondition: (combatantId, condition) =>
    set((s) => ({
      combat: s.combat.map((c) => (c.id === combatantId ? { ...c, conditions: [...(c.conditions ?? []), { ...condition, id: newId("k") }] } : c)),
    })),
  updateCondition: (combatantId, conditionId, patch) =>
    set((s) => ({
      combat: s.combat.map((c) =>
        c.id === combatantId ? { ...c, conditions: (c.conditions ?? []).map((x) => (x.id === conditionId ? { ...x, ...patch } : x)) } : c,
      ),
    })),
  removeCondition: (combatantId, conditionId) =>
    set((s) => ({
      combat: s.combat.map((c) => (c.id === combatantId ? { ...c, conditions: (c.conditions ?? []).filter((x) => x.id !== conditionId) } : c)),
    })),
  nextTurn: () => {
    const r = nextTurn(get());
    set({ combat: r.combat, round: r.round, turn: r.turn });
    return r;
  },
  previousTurn: () => set((s) => previousTurn(s)),
  endCombat: () => set({ round: 0, turn: null }),
  remapStats: (fromPath, toPath) =>
    set((s) => {
      const remap = (key: string | null | undefined) => {
        if (!key?.startsWith("note:")) return key;
        const p = key.slice(5);
        if (p === fromPath) return `note:${toPath}`;
        if (p.startsWith(fromPath + "/")) return `note:${toPath}${p.slice(fromPath.length)}`;
        return key;
      };
      if (!s.combat.some((c) => remap(c.stats) !== c.stats)) return {};
      return { combat: s.combat.map((c) => ({ ...c, stats: remap(c.stats) })) };
    }),
}));

/** The persisted part of the session. */
export function persistedSession(s: Session): Session {
  return {
    focus: s.focus,
    playerLevelId: s.playerLevelId,
    blackout: s.blackout,
    rotation: s.rotation,
    compass: s.compass,
    combat: s.combat,
    round: s.round,
    turn: s.turn,
    brightness: s.brightness,
  };
}
