import { backend } from "./backend";
import { parseDungeon, serializeDungeon } from "./serialize";
import { DEFAULT_SESSION, type Dungeon, type Session } from "../types";
import { useDoc } from "../store/doc";
import { useSession } from "../store/session";
import { useUi } from "../store/ui";
import { flush, startAutosave, stopAutosave } from "../store/autosave";
import { flushNotes, loadNotes, resetNotes } from "../notes/store";
import { toFileRelative } from "./markdownPaths";

/**
 * Dungeons from before notes existed had a single background.md; it becomes
 * notes/Background.md (or "Background 1.md", ... if that name is taken).
 */
async function migrateBackground(dir: string, legacy: string | null) {
  if (legacy === null) return;
  const listing = await backend.loadNotes(dir);
  let name = "Background";
  for (let n = 1; listing.files[`${name}.md`] !== undefined; n++) name = `Background ${n}`;
  const writes = legacy.trim() ? { [`notes/${name}.md`]: toFileRelative(legacy, `notes/${name}.md`) + "\n" } : {};
  await backend.saveFiles(dir, writes, ["background.md"]);
}

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
  const { dungeon, session, warnings, legacyBackground } = parseDungeon(files);
  await migrateBackground(dir, legacyBackground);
  await loadNotes(dir);
  activate(dir, dungeon, session);
  await rememberRecent(dir);
  await backend.showPlayerWindow();
  return warnings;
}

/** Creates a new, empty dungeon in `dir` and opens it. */
export async function createDungeon(dir: string, name: string): Promise<void> {
  await closeDungeon();
  const dungeon: Dungeon = { name, levels: [], playlists: [] };
  const session: Session = { ...DEFAULT_SESSION };
  await backend.saveFiles(dir, serializeDungeon(dungeon, session), []);
  await openDungeon(dir);
}

/** Saves and unloads the current dungeon (back to the start screen). */
export async function closeDungeon(): Promise<void> {
  await flush();
  await flushNotes();
  stopAutosave();
  resetNotes();
  useDoc.getState().load(null);
  useSession.getState().setSession({ ...DEFAULT_SESSION });
  useUi.getState().set({ dungeonDir: null, currentLevelId: null, selection: null, draw: null, dialog: null });
}
