import { useState } from "react";
import { useStore } from "zustand";
import { useDoc, undo, redo } from "../store/doc";
import { useSession } from "../store/session";
import { useUi, type DrawTool } from "../store/ui";
import { backend, type MonitorInfo, type Settings } from "../lib/backend";
import { closeDungeon } from "../lib/dungeonIO";
import { confirmAsync, Dropdown } from "../components/ui";
import type { EntityKind } from "../types";
import { openDoc, useNotes } from "../notes/store";

export const TOOLS: { tool: DrawTool; label: string; icon: string }[] = [
  { tool: "box", label: "Box", icon: "▭" },
  { tool: "circle", label: "Circle", icon: "◯" },
  { tool: "freeform", label: "Freeform", icon: "✎" },
  { tool: "polygon", label: "Polygon", icon: "⬠" },
];

export function ToolMenu({
  label,
  title,
  onPick,
}: {
  label: string;
  title: string;
  onPick: (tool: DrawTool) => void;
}) {
  return (
    <Dropdown label={label} title={title}>
      {(close) =>
        TOOLS.map((t) => (
          <button
            key={t.tool}
            className="menu-item"
            onClick={() => {
              close();
              onPick(t.tool);
            }}
          >
            <span className="menu-icon">{t.icon}</span> {t.label}
          </button>
        ))
      }
    </Dropdown>
  );
}

function startCreate(kind: EntityKind, tool: DrawTool) {
  useUi.getState().set({ draw: { tool, purpose: { type: "create", kind } }, selection: null, editingShape: false });
}

function LevelsMenu() {
  const dungeon = useDoc((s) => s.dungeon)!;
  const currentLevelId = useUi((s) => s.currentLevelId);
  const current = dungeon.levels.find((l) => l.id === currentLevelId);

  const remove = async (levelId: string, name: string) => {
    const ok = await confirmAsync(
      <>
        Delete level <b>{name}</b> with all its rooms, doors, objects and descriptions? (You can still undo with
        Ctrl+Z.)
      </>,
      { confirmLabel: "Delete level", danger: true },
    );
    if (!ok) return;
    const focus = useSession.getState().focus;
    if (focus?.levelId === levelId) useSession.getState().clearFocus();
    useDoc.getState().deleteLevel(levelId);
    const remaining = useDoc.getState().dungeon?.levels ?? [];
    if (useUi.getState().currentLevelId === levelId) {
      useUi.getState().set({ currentLevelId: remaining[0]?.id ?? null, selection: null, draw: null });
    }
  };

  return (
    <Dropdown label={<>{current?.name ?? "No level"}</>} title="Levels: switch, add, edit or delete">
      {(close) => (
        <>
          {dungeon.levels.length === 0 && <div className="menu-empty">No levels yet</div>}
          {dungeon.levels.map((l) => (
            <div key={l.id} className={`menu-row ${l.id === currentLevelId ? "current" : ""}`}>
              <button
                className="menu-item grow"
                onClick={() => {
                  close();
                  useUi.getState().set({ currentLevelId: l.id, selection: null, draw: null, editingShape: false });
                }}
              >
                {l.name}
                <span className="menu-meta">
                  {l.rooms.length} room{l.rooms.length === 1 ? "" : "s"}
                  {l.rooms.some((r) => r.playerKnown) ? " · 👁" : ""}
                </span>
              </button>
              <button
                className="icon-btn danger-hover"
                title={`Delete ${l.name}`}
                onClick={() => {
                  close();
                  void remove(l.id, l.name);
                }}
              >
                🗑
              </button>
            </div>
          ))}
          <div className="menu-divider" />
          <button
            className="menu-item"
            onClick={() => {
              close();
              useUi.getState().set({ dialog: { type: "addLevel" } });
            }}
          >
            ＋ Add level…
          </button>
          {current && (
            <button
              className="menu-item"
              onClick={() => {
                close();
                useUi.getState().set({ dialog: { type: "editLevel", levelId: current.id } });
              }}
            >
              ⚙ Edit “{current.name}”…
            </button>
          )}
        </>
      )}
    </Dropdown>
  );
}

function WindowsMenu() {
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const refresh = () => {
    backend.listMonitors().then(setMonitors).catch(() => setMonitors([]));
    backend.getSettings().then(setSettings).catch(() => {});
  };
  const assign = async (label: "dm" | "player", name: string) => {
    await backend.assignMonitor(label, name || null);
    refresh();
  };
  return (
    <div onMouseDown={refresh}>
      <Dropdown label="🖥" title="Windows: player window, fullscreen & displays" align="right">
        {(close) => (
          <div className="menu-form">
            <button
              className="menu-item"
              onClick={() => {
                close();
                void backend.showPlayerWindow();
              }}
            >
              Show player window
            </button>
            <label className="menu-check">
              <input
                type="checkbox"
                checked={settings?.playerFullscreen ?? false}
                onChange={async (e) => {
                  await backend.showPlayerWindow();
                  await backend.setPlayerFullscreen(e.target.checked);
                  refresh();
                }}
              />
              Player window fullscreen (kiosk)
            </label>
            <label>
              DM window display
              <select value={settings?.dmMonitor ?? ""} onChange={(e) => void assign("dm", e.target.value)}>
                <option value="">(don't move)</option>
                {monitors.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name} — {m.width}×{m.height}
                    {m.primary ? " (primary)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Player window display
              <select value={settings?.playerMonitor ?? ""} onChange={(e) => void assign("player", e.target.value)}>
                <option value="">(don't move)</option>
                {monitors.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name} — {m.width}×{m.height}
                    {m.primary ? " (primary)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <p className="hint">Display choices are remembered and applied on the next start.</p>
          </div>
        )}
      </Dropdown>
    </div>
  );
}

/** DM controls for what the player window shows. */
function PlayerControls() {
  const blackout = useSession((s) => s.blackout);
  const rotation = useSession((s) => s.rotation);
  const compass = useSession((s) => s.compass);
  const handout = useSession((s) => s.handout);
  const session = useSession.getState;

  const showWholeLevel = () => {
    const dungeon = useDoc.getState().dungeon;
    const levelId = session().playerLevelId ?? useUi.getState().currentLevelId;
    const level = dungeon?.levels.find((l) => l.id === levelId);
    if (!level || !level.rooms.some((r) => r.playerKnown)) {
      useUi.getState().showToast(`Nothing is revealed on ${level?.name ?? "this level"} yet.`);
      return;
    }
    session().showWholeLevel(level.id);
  };

  return (
    <div className="tb-group" role="group" aria-label="Player window">
      <span className="tb-group-label">Players</span>
      <button
        className={`tb-btn ${blackout ? "danger-on" : ""}`}
        onClick={() => session().setBlackout(!blackout)}
        title={blackout ? "The player window is black — click to show the map again" : "Black out the player window"}
      >
        {blackout ? "◼ Blacked out" : "◼ Blackout"}
      </button>
      <button
        className="tb-btn"
        onClick={showWholeLevel}
        title="Zoom the player window out to everything revealed on the players' current level (clears the focused room)"
      >
        ⤢ Whole level
      </button>
      <button
        className="tb-btn"
        onClick={() => session().toggleRotation()}
        title={rotation === 0 ? "Rotate the player view 90° clockwise" : "Rotate the player view back"}
      >
        {rotation === 0 ? "⟳ Rotate" : "⟲ Rotate back"}
      </button>
      <button
        className={`tb-btn ${compass ? "active" : ""}`}
        onClick={() => session().setCompass(!compass)}
        title={compass ? "Hide the compass on the player window" : "Show a compass on the player window"}
      >
        🧭 Compass
      </button>
      {handout && (
        <button className="tb-btn danger-on" onClick={() => session().showHandout(null)} title="The players see an image — click to go back to the map">
          🖼 Hide handout
        </button>
      )}
    </div>
  );
}

function SaveStatus() {
  const status = useUi((s) => s.saveStatus);
  const error = useUi((s) => s.saveError);
  const label = status === "saving" ? "Saving…" : status === "error" ? "⚠ Save failed" : "✓";
  return (
    <span className={`save-status ${status}`} title={error ?? "Saved — every change is saved automatically"}>
      {label}
    </span>
  );
}

export function Toolbar() {
  const dungeon = useDoc((s) => s.dungeon)!;
  const currentLevelId = useUi((s) => s.currentLevelId);
  const canUndo = useStore(useDoc.temporal, (s) => s.pastStates.length > 0);
  const canRedo = useStore(useDoc.temporal, (s) => s.futureStates.length > 0);
  const hasLevel = !!currentLevelId && dungeon.levels.some((l) => l.id === currentLevelId);
  const mainView = useNotes((s) => s.mainView);
  const setView = (v: "dungeon" | "notes") => useNotes.getState().set({ mainView: v });

  return (
    <div className="toolbar">
      <Dropdown label={<b>{dungeon.name}</b>} title="Dungeon">
        {(close) => (
          <>
            <button
              className="menu-item"
              onClick={() => {
                close();
                void closeDungeon();
              }}
            >
              ⇄ Switch dungeon…
            </button>
          </>
        )}
      </Dropdown>
      <div className="view-switch" role="tablist">
        <button className={mainView === "dungeon" ? "on" : ""} onClick={() => setView("dungeon")} title="Map and rooms (⌘1)">
          🗺 Dungeon
        </button>
        <button className={mainView === "notes" ? "on" : ""} onClick={() => setView("notes")} title="Notes (⌘2) · ⌘O open a note · ⌘⇧F search everything">
          📝 Notes
        </button>
      </div>

      {mainView === "dungeon" && (
        <>
      <span className="tb-sep" />
      <LevelsMenu />
      <button
        className="tb-btn"
        disabled={!hasLevel}
        onClick={() => currentLevelId && openDoc({ kind: "level", levelId: currentLevelId })}
        title="Open this level's document in Notes (background and all room texts)"
      >
        Level doc
      </button>

      <span className="tb-sep" />
      {hasLevel && (
        <>
          <ToolMenu label="+ Room" title="Draw a new room (corridors are rooms too)" onPick={(t) => startCreate("room", t)} />
          <ToolMenu label="+ Door" title="Draw a door (hidden from players)" onPick={(t) => startCreate("door", t)} />
          <ToolMenu label="+ Object" title="Create global object — a freeform shape with a description, not tied to a room" onPick={(t) => startCreate("object", t)} />
        </>
      )}
        </>
      )}

      <span className="grow" />
      <PlayerControls />
      <span className="tb-sep" />
      <button className="tb-btn" disabled={!canUndo} onClick={undo} title="Undo (Ctrl/⌘+Z)">
        ↶
      </button>
      <button className="tb-btn" disabled={!canRedo} onClick={redo} title="Redo (Ctrl/⌘+Shift+Z)">
        ↷
      </button>
      <SaveStatus />
      <WindowsMenu />
    </div>
  );
}
