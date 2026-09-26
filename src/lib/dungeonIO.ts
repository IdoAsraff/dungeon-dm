import { backend } from "./backend";
import { parseDungeon, serializeDungeon } from "./serialize";
import type { Dungeon, Session } from "../types";
import { useDoc } from "../store/doc";
import { useSession } from "../store/session";
import { useUi } from "../store/ui";
import { flush, startAutosave, stopAutosave } from "../store/autosave";

const MAX_RECENT = 8;

async function rememberRecent(dir: string) {
  try {
    const s = await backend.getSettings();
    const recent = [dir, ...s.recentDungeons.filter((d) => d !== dir)].slice(0, MAX_RECENT);
    await backend.updateSettings({ recentDungeons: recent });
  } catch (e) {
    console.warn("could not update recent dungeons", e);
  }
}

function activate(dir: string, dungeon: Dungeon, session: Session) {
  stopAutosave();
  useDoc.getState().load(dungeon);
  useSession.getState().setSession(session);
  const firstLevel = dungeon.levels[0]?.id ?? null;
  useUi.getState().set({
    dungeonDir: dir,
    currentLevelId: firstLevel,
    selection: null,
    hover: null,
    draw: null,
    editingShape: false,
    dialog: null,
    saveStatus: "saved",
    saveError: null,
  });
  startAutosave(dir, serializeDungeon(dungeon, session));
}

/** Loads the dungeon in `dir` into the DM window. Returns load warnings. */
export async function openDungeon(dir: string): Promise<string[]> {
  await closeDungeon();
  const files = await backend.loadDungeon(dir);
  const { dungeon, session, warnings } = parseDungeon(files);
  activate(dir, dungeon, session);
  await rememberRecent(dir);
  await backend.showPlayerWindow();
  return warnings;
}

/** Creates a new, empty dungeon in `dir` and opens it. */
export async function createDungeon(dir: string, name: string): Promise<void> {
  await closeDungeon();
  const dungeon: Dungeon = { name, background: "", levels: [] };
  const session: Session = { focus: null, playerLevelId: null };
  await backend.saveFiles(dir, serializeDungeon(dungeon, session), []);
  await openDungeon(dir);
}

/** Saves and unloads the current dungeon (back to the start screen). */
export async function closeDungeon(): Promise<void> {
  await flush();
  stopAutosave();
  useDoc.getState().load(null);
  useSession.getState().setSession({ focus: null, playerLevelId: null });
  useUi.getState().set({ dungeonDir: null, currentLevelId: null, selection: null, draw: null, dialog: null });
}
