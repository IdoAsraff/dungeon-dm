import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit, listen } from "@tauri-apps/api/event";
import { useDoc, undo, redo } from "../store/doc";
import { useSession } from "../store/session";
import { useUi, type PlayerViewport } from "../store/ui";
import { flush } from "../store/autosave";
import { assetUrl } from "../lib/backend";
import { buildPlayerData, EVENTS } from "../lib/playerData";
import { ConfirmHost, Toast } from "../components/ui";
import { StartScreen } from "./StartScreen";
import { Toolbar } from "./Toolbar";
import { DmMap } from "./DmMap";
import { SidePanel } from "./SidePanel";
import { PlayerPreview } from "./PlayerPreview";
import { Dialogs } from "./Dialogs";
import { CombatPanel } from "./CombatPanel";
import { useSfxTriggers } from "../audio/triggers";
import { usePrefs } from "../lib/prefs";
import { EditorView } from "@codemirror/view";
import { openSearchPanel } from "@codemirror/search";
import { NotesView } from "../notes/NotesView";
import { PeekPanel } from "../notes/PeekPanel";
import { QuickSwitcher } from "../notes/QuickSwitcher";
import { closeTab, createNote, dirOf, flushNotes, navigateHistory, openDoc, useNotes } from "../notes/store";
import { openSearch } from "../notes/nav";

/** Keeps the player window in sync with the dungeon and records its viewport. */
function usePlayerSync() {
  useEffect(() => {
    let lastSent = "";
    const send = (force = false) => {
      const dir = useUi.getState().dungeonDir;
      const data = buildPlayerData(useDoc.getState().dungeon, useSession.getState(), (p) => (dir ? assetUrl(dir, p) : p));
      const json = JSON.stringify(data);
      if (!force && json === lastSent) return;
      lastSent = json;
      void emit(EVENTS.playerData, data);
    };
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => send());
    };
    const unsubs = [useDoc.subscribe(schedule), useSession.subscribe(schedule), useUi.subscribe((s, p) => s.dungeonDir !== p.dungeonDir && schedule())];
    const unlisten = [
      listen(EVENTS.playerReady, () => send(true)),
      listen(EVENTS.playerHidden, () => useUi.getState().set({ playerViewport: null })),
      listen<PlayerViewport>(EVENTS.playerViewport, (e) => {
        useUi.getState().set({ playerViewport: e.payload });
        const session = useSession.getState();
        if (e.payload.levelId && e.payload.levelId !== session.playerLevelId) session.setPlayerLevel(e.payload.levelId);
      }),
    ];
    send(true);
    return () => {
      cancelAnimationFrame(frame);
      unsubs.forEach((u) => u());
      unlisten.forEach((u) => void u.then((f) => f()));
    };
  }, []);
}

function isTextInput(t: EventTarget | null) {
  return t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
}

/** Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z (or Ctrl+Y) redo — text editors keep their own undo. */
function useUndoKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || isTextInput(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** Notes shortcuts (Obsidian-like). */
function useNotesKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const notes = useNotes.getState();
      const key = e.key.toLowerCase();
      if (mod && !e.shiftKey && !e.altKey && key === "o") {
        e.preventDefault();
        notes.set({ quickSwitcher: true });
      } else if (mod && e.shiftKey && key === "f") {
        e.preventDefault();
        openSearch();
      } else if (mod && !e.shiftKey && key === "1") {
        e.preventDefault();
        notes.set({ mainView: "dungeon" });
      } else if (mod && !e.shiftKey && key === "2") {
        e.preventDefault();
        notes.set({ mainView: "notes" });
      } else if (notes.mainView === "notes" && mod && !e.shiftKey && key === "w" && notes.activeTab) {
        e.preventDefault();
        closeTab(notes.activeTab);
      } else if (notes.mainView === "notes" && mod && !e.shiftKey && key === "n") {
        e.preventDefault();
        const active = notes.tabs.find((t) => t.id === notes.activeTab)?.doc;
        void createNote(active?.kind === "note" ? dirOf(active.path) : "").then((path) => openDoc({ kind: "note", path }));
      } else if (notes.mainView === "notes" && mod && e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        navigateHistory(e.key === "ArrowLeft" ? "back" : "forward");
      } else if (mod && !e.shiftKey && key === "f") {
        // ⌘F outside an editor: search in the open note / peek.
        if ((e.target as HTMLElement).closest?.(".cm-editor")) return;
        const scope = notes.mainView === "notes" ? ".notes-main" : ".peek-panel";
        const el = document.querySelector(`${scope} .note-editor .cm-editor`);
        const view = el ? EditorView.findFromDOM(el as HTMLElement) : null;
        if (view) {
          e.preventDefault();
          view.focus();
          openSearchPanel(view);
        }
      } else if (e.key === "Escape" && notes.peek && !(e.target as HTMLElement).closest?.(".cm-editor, input, textarea")) {
        notes.set({ peek: null });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** Drops selection/editing state that no longer points at anything (e.g. after undo). */
function useSelectionGuard() {
  useEffect(
    () =>
      useDoc.subscribe((s) => {
        const ui = useUi.getState();
        const dungeon = s.dungeon;
        if (!dungeon) return;
        let levelId = ui.currentLevelId;
        if (!dungeon.levels.some((l) => l.id === levelId)) {
          levelId = dungeon.levels[0]?.id ?? null;
          ui.set({ currentLevelId: levelId, selection: null, editingShape: false, draw: null });
        }
        const level = dungeon.levels.find((l) => l.id === levelId);
        const sel = ui.selection;
        if (sel && level) {
          const list: { id: string }[] = sel.kind === "room" ? level.rooms : sel.kind === "door" ? level.doors : level.objects;
          if (!list.some((e) => e.id === sel.id)) ui.set({ selection: null, editingShape: false });
        }
        const focus = useSession.getState().focus;
        if (focus) {
          const fl = dungeon.levels.find((l) => l.id === focus.levelId);
          if (!fl?.rooms.some((r) => r.id === focus.roomId)) useSession.getState().clearFocus();
        }
      }),
    [],
  );
}

export function DmApp() {
  const dir = useUi((s) => s.dungeonDir);
  const dungeon = useDoc((s) => s.dungeon);
  const currentLevelId = useUi((s) => s.currentLevelId);

  usePlayerSync();
  useUndoKeys();
  useNotesKeys();
  useSelectionGuard();
  useSfxTriggers();
  useEffect(() => void usePrefs.getState().load(), []);
  const mainView = useNotes((s) => s.mainView);

  // Save pending changes before the window closes.
  useEffect(() => {
    const p = getCurrentWindow().onCloseRequested(async () => {
      await flush();
      await flushNotes();
    });
    return () => void p.then((f) => f());
  }, []);

  useEffect(() => {
    document.title = dungeon ? `${dungeon.name} — Dungeon DM` : "Dungeon DM";
    void getCurrentWindow().setTitle(document.title);
  }, [dungeon?.name]);

  if (!dir || !dungeon) {
    return (
      <>
        <StartScreen />
        <ConfirmHost />
        <Toast />
      </>
    );
  }

  const level = dungeon.levels.find((l) => l.id === currentLevelId);

  return (
    <div className="dm-root">
      <Toolbar />
      <div className="dm-main" style={{ display: mainView === "dungeon" ? undefined : "none" }}>
        <div className="dm-map-area">
          {level ? (
            <DmMap key={level.id} level={level} />
          ) : (
            <div className="empty-state">
              <h2>{dungeon.name}</h2>
              <p>This dungeon has no levels yet.</p>
              <button className="primary big" onClick={() => useUi.getState().set({ dialog: { type: "addLevel" } })}>
                + Add the first level
              </button>
            </div>
          )}
          <div className="left-dock">
            <CombatPanel />
            <PlayerPreview />
          </div>
          <PeekPanel />
        </div>
        {level && <SidePanel level={level} />}
      </div>
      <div className="notes-host" style={{ display: mainView === "notes" ? undefined : "none" }}>
        <NotesView />
        <div className="left-dock">
          <CombatPanel />
        </div>
      </div>
      <QuickSwitcher />
      <Dialogs />
      <ConfirmHost />
      <Toast />
    </div>
  );
}
