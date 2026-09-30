/** The Combat tab (⌘4): cheat sheet | combatant list | inspector. */
import { useSession } from "../store/session";
import { confirmAsync } from "../components/ui";
import { useResizableWidth } from "../components/useResizableWidth";
import type { Combatant } from "../types";
import { advanceTurn, enemyImages, sameImages } from "./actions";
import { CheatSheet } from "./CheatSheet";
import { AddCombatant, CombatList } from "./CombatList";
import { Inspector } from "./Inspector";
import { inspectCombatant, useCombatUi } from "./store";

export async function confirmClearEnemies() {
  const enemies = useSession.getState().combat.filter((c) => c.side === "enemy").length;
  const ok = await confirmAsync(
    <>
      Remove all {enemies} enem{enemies === 1 ? "y" : "ies"} from the combat tracker? Party members stay.
    </>,
    { confirmLabel: "Clear enemies", danger: true },
  );
  if (ok) useSession.getState().clearEnemies();
}

/** Round, whose turn, and the turn buttons. */
export function TurnControls({ compact }: { compact?: boolean }) {
  const round = useSession((s) => s.round);
  const turn = useSession((s) => s.combat.find((c) => c.id === s.turn));
  const count = useSession((s) => s.combat.length);
  if (!count) return null;
  return (
    <span className={`turn-controls ${compact ? "compact" : ""}`}>
      {round > 0 ? (
        <span className="turn-round" title={turn ? `${turn.name}'s turn` : undefined}>
          Round {round}
          {!compact && turn ? <span className="muted"> · {turn.name}</span> : null}
        </span>
      ) : (
        !compact && <span className="muted">Not started</span>
      )}
      {round > 0 && !compact && (
        <button className="icon-btn" onClick={() => useSession.getState().previousTurn()} title="Previous turn (⌘⇧J)">
          ⏮
        </button>
      )}
      <button className="turn-next" onClick={advanceTurn} title={round > 0 ? "Next turn (⌘J)" : "Start: the first in the list goes first (⌘J)"}>
        {round > 0 ? (compact ? "⏭" : "⏭ Next turn") : compact ? "▶ Start" : "▶ Start combat"}
      </button>
      {round > 0 && !compact && (
        <button className="icon-btn" onClick={() => useSession.getState().endCombat()} title="End combat: stop counting rounds (the list stays)">
          ⏹
        </button>
      )}
    </span>
  );
}

function ShowEnemies() {
  const combat = useSession((s) => s.combat);
  const handout = useSession((s) => s.handout);
  const images = enemyImages(combat);
  if (!images.length) return null;
  const showing = sameImages(handout, images);
  return (
    <button
      className={showing ? "active" : ""}
      onClick={() => useSession.getState().showHandouts(showing ? [] : images)}
      title={showing ? "The players see the enemies — click to go back to the map" : "Show the images of all enemies still standing to the players"}
    >
      {showing ? "🖼 Hide enemies" : `🖼 Show all enemies (${images.length})`}
    </button>
  );
}

export function CombatView() {
  const cheatOpen = useCombatUi((s) => s.cheatOpen);
  const enemies = useSession((s) => s.combat.some((c) => c.side === "enemy"));
  const { width, handleProps } = useResizableWidth("combat.inspector", 460, 320, 900, "left");
  const openStats = (c: Combatant) => inspectCombatant(c.id);
  return (
    <div className="combat-view">
      {cheatOpen ? (
        <CheatSheet />
      ) : (
        <button className="cheat-collapsed" onClick={() => useCombatUi.getState().set({ cheatOpen: true })} title="Show the cheat sheet">
          » Cheat sheet
        </button>
      )}
      <main className="combat-main">
        <div className="combat-main-head">
          <span className="combat-title">⚔ Combat</span>
          <TurnControls />
          <span className="grow" />
          <ShowEnemies />
          {enemies && (
            <button className="combat-clear" onClick={() => void confirmClearEnemies()} title="Remove every enemy, keep the party">
              Clear enemies
            </button>
          )}
        </div>
        <div className="combat-main-list">
          <CombatList onStats={openStats} />
          <AddCombatant />
        </div>
      </main>
      <aside className="combat-inspector" style={{ width }}>
        <div className="panel-resize left" {...handleProps} />
        <div className="combat-inspector-scroll">
          <Inspector />
        </div>
      </aside>
    </div>
  );
}
