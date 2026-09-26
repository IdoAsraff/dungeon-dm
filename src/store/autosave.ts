/**
 * Automatically saves every change to disk. The whole dungeon is serialized
 * to a path -> content map and only files that changed are written (or
 * deleted), so saves are cheap and git diffs stay small.
 */
import { backend } from "../lib/backend";
import { diffFiles, serializeDungeon, type FileMap } from "../lib/serialize";
import { useDoc } from "./doc";
import { useSession } from "./session";
import { useUi } from "./ui";

const DEBOUNCE_MS = 400;

let dir: string | null = null;
let lastSaved: FileMap = {};
let timer: ReturnType<typeof setTimeout> | null = null;
let chain: Promise<void> = Promise.resolve();
let unsubscribers: (() => void)[] = [];

function currentFiles(): FileMap | null {
  const dungeon = useDoc.getState().dungeon;
  if (!dungeon) return null;
  const { focus, playerLevelId } = useSession.getState();
  return serializeDungeon(dungeon, { focus, playerLevelId });
}

function schedule() {
  if (!dir) return;
  useUi.getState().set({ saveStatus: "saving" });
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flush(), DEBOUNCE_MS);
}

/** Writes pending changes now. Safe to call repeatedly. */
export function flush(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  chain = chain.then(async () => {
    const target = dir;
    const next = currentFiles();
    if (!target || !next) return;
    const { writes, deletes } = diffFiles(lastSaved, next);
    if (Object.keys(writes).length === 0 && deletes.length === 0) {
      useUi.getState().set({ saveStatus: "saved", saveError: null });
      return;
    }
    try {
      await backend.saveFiles(target, writes, deletes);
      if (dir === target) lastSaved = next;
      useUi.getState().set({ saveStatus: "saved", saveError: null });
    } catch (e) {
      console.error("save failed", e);
      useUi.getState().set({ saveStatus: "error", saveError: String(e) });
    }
  });
  return chain;
}

/**
 * Starts autosaving `dungeonDir`. `baseline` is what is known to be on disk
 * (the serialization of the dungeon as loaded).
 */
export function startAutosave(dungeonDir: string, baseline: FileMap) {
  stopAutosave();
  dir = dungeonDir;
  lastSaved = baseline;
  unsubscribers = [
    useDoc.subscribe((s, prev) => {
      if (s.dungeon !== prev.dungeon) schedule();
    }),
    useSession.subscribe((s, prev) => {
      if (s.focus !== prev.focus || s.playerLevelId !== prev.playerLevelId) schedule();
    }),
  ];
}

export function stopAutosave() {
  unsubscribers.forEach((u) => u());
  unsubscribers = [];
  if (timer) clearTimeout(timer);
  timer = null;
  dir = null;
  lastSaved = {};
}
