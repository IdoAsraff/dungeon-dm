/** Following links: opening notes/level documents, peeking, selecting rooms. */
import { useDoc } from "../store/doc";
import { useUi } from "../store/ui";
import { createNote, dirOf, openDoc, useNotes, type DocRef, type Reveal } from "./store";
import { levelHeadingTarget, resolveLink } from "./links";

/** Where a link was clicked: the dungeon tab, a notes tab, or the peek panel. */
export type Origin = "dungeon" | "notes" | "peek";

export function openRef(
  ref: DocRef,
  opts: { heading?: string | null; newTab?: boolean; origin: Origin; reveal?: Omit<Reveal, "nonce"> },
) {
  const reveal = opts.reveal ?? (opts.heading ? { heading: opts.heading } : undefined);
  if (opts.origin !== "notes" && !opts.newTab) {
    // A room of a level from the dungeon tab: select it on the map.
    if (opts.origin === "dungeon" && ref.kind === "level") {
      const level = useDoc.getState().dungeon?.levels.find((l) => l.id === ref.levelId);
      const t = level ? levelHeadingTarget(level, opts.heading ?? null) : null;
      if (level && t?.kind === "room") {
        const target = { kind: "room" as const, id: t.roomId };
        useUi.getState().set({ currentLevelId: level.id, selection: target, editingShape: false, draw: null, zoomRequest: { target, nonce: Date.now() } });
        return;
      }
    }
    const notes = useNotes.getState();
    const key = ref.kind === "note" ? `note:${ref.path}` : `level:${ref.levelId}`;
    notes.set({
      peek: ref,
      reveal: reveal ? { ...notes.reveal, [key]: { ...reveal, nonce: Date.now() + Math.random() } } : notes.reveal,
    });
    return;
  }
  openDoc(ref, { newTab: opts.newTab, reveal });
}

/** Follows a [[link]]; like Obsidian, a link to a missing note creates it. */
export async function openWikiLink(target: string, heading: string | null, opts: { newTab: boolean; origin: Origin }) {
  let ref = resolveLink(target);
  if (!ref) {
    const folder = dirOf(target);
    const exists = !folder || useNotes.getState().folders.includes(folder);
    try {
      const path = await createNote(exists ? folder : "", target.slice(target.lastIndexOf("/") + 1));
      ref = { kind: "note", path };
      useUi.getState().showToast(`Created note “${target}”`);
    } catch (e) {
      useUi.getState().showToast(String(e instanceof Error ? e.message : e));
      return;
    }
  }
  openRef(ref, { heading, newTab: opts.newTab, origin: opts.origin });
}

export function openSearch(query?: string) {
  const s = useNotes.getState();
  s.set({ mainView: "notes", sidebar: "search", searchQuery: query ?? s.searchQuery, searchFocus: s.searchFocus + 1 });
}
