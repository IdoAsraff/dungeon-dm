import { useEffect, useState } from "react";
import { useSession } from "../store/session";
import type { Combatant } from "../types";
import { useResizableWidth } from "../components/useResizableWidth";
import { AddCombatant, CombatList } from "../combat/CombatList";
import { confirmClearEnemies, TurnControls } from "../combat/CombatView";
import { inspectCombatant } from "../combat/store";
import { resolveStats } from "../rules/statNotes";
import { openDoc, useNotes, type DocRef } from "../notes/store";

const MIN_KEY = "dm.combat.minimized";

function loadMinimized(): boolean {
  try {
    return localStorage.getItem(MIN_KEY) === "1";
  } catch {
    return false;
  }
}

function openCombatTab(id?: string) {
  if (id) inspectCombatant(id);
  useNotes.getState().set({ mainView: "combat" });
}

/** A combatant's stat block beside the map (peek), or in Notes when on the Notes view. */
function showStats(c: Combatant) {
  const r = resolveStats(c.stats);
  if (!r) return openCombatTab(c.id);
  const doc: DocRef = r.source === "note" ? { kind: "note", path: r.path! } : { kind: "srd", id: r.key.slice(4) };
  if (useNotes.getState().mainView === "dungeon") useNotes.getState().set({ peek: doc });
  else openDoc(doc);
}

/**
 * The compact combat tracker on the Dungeon and Notes views: names, condition
 * icons, AC and HP, in turn order. The full tracker is the Combat tab.
 */
export function CombatPanel() {
  const combat = useSession((s) => s.combat);
  const [minimized, setMinimized] = useState(loadMinimized);
  const { width, handleProps } = useResizableWidth("dm.combat.width", 300, 240, 640, "right");
  useEffect(() => {
    try {
      localStorage.setItem(MIN_KEY, minimized ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [minimized]);

  if (minimized) {
    return (
      <button className="combat-pill" onClick={() => setMinimized(false)} title="Show the combat tracker">
        ⚔ Combat{combat.length ? ` (${combat.length})` : ""}
      </button>
    );
  }

  const enemies = combat.some((c) => c.side === "enemy");
  return (
    <div className="combat-panel" style={{ width }}>
      <div className="panel-resize right" {...handleProps} />
      <div className="combat-header">
        <button className="combat-title link" onClick={() => openCombatTab()} title="Open the Combat tab (⌘4)">
          ⚔ Combat
        </button>
        <TurnControls compact />
        <span className="grow" />
        {enemies && (
          <button className="combat-clear" onClick={() => void confirmClearEnemies()} title="Remove every enemy, keep the party">
            Clear
          </button>
        )}
        <button className="icon-btn" title="Minimize" onClick={() => setMinimized(true)}>
          ▁
        </button>
      </div>
      <CombatList compact onStats={showStats} />
      <AddCombatant compact />
    </div>
  );
}
