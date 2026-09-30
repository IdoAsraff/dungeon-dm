/**
 * Stat blocks as linkable things: the DM's stat block notes (anywhere in the
 * notes folder) and the bundled SRD monsters. A reference is a document key:
 * "note:Stats/Goblin.md" or "srd:monster:goblin".
 */
import { useUi } from "../store/ui";
import { baseName } from "../lib/wikiLinks";
import { checkName, createNote, dirOf, openDoc, useNotes } from "../notes/store";
import { SRD_MONSTER_LIST, srdMonster } from "./srd";
import { emptyStatblock, newStatNote, parseStatNote, type Statblock } from "./statblock";

/** Default folder for new stat blocks. */
export const STATS_FOLDER = "Stats";

const parsed = new Map<string, { text: string; sb: Statblock | null }>();

/** The stat block of a note, or null if it isn't a (valid) stat block note. */
export function noteStatblock(path: string): Statblock | null {
  const text = useNotes.getState().files[path];
  if (text === undefined) return null;
  const hit = parsed.get(path);
  if (hit && hit.text === text) return hit.sb;
  const sb = parseStatNote(text).statblock;
  parsed.set(path, { text, sb });
  return sb;
}

export interface ResolvedStats {
  key: string;
  sb: Statblock;
  source: "note" | "srd";
  /** For notes: the note path. */
  path: string | null;
}

export function resolveStats(key: string | null | undefined): ResolvedStats | null {
  if (!key) return null;
  if (key.startsWith("note:")) {
    const path = key.slice(5);
    const sb = noteStatblock(path);
    return sb ? { key, sb, source: "note", path } : null;
  }
  if (key.startsWith("srd:monster:")) {
    const m = srdMonster(key.slice(12));
    return m ? { key, sb: m, source: "srd", path: null } : null;
  }
  return null;
}

export interface StatsOption {
  key: string;
  name: string;
  /** "custom" or "SRD" plus CR. */
  detail: string;
  source: "note" | "srd";
  hp: number;
  ac: number;
}

/** All stat blocks for the combat autocomplete: the DM's own first, then the SRD. */
export function statsOptions(): StatsOption[] {
  const files = useNotes.getState().files;
  const custom: StatsOption[] = [];
  for (const path of Object.keys(files).sort()) {
    const sb = noteStatblock(path);
    if (sb) custom.push({ key: `note:${path}`, name: sb.name || baseName(path), detail: `custom · CR ${sb.cr}`, source: "note", hp: sb.hp, ac: sb.ac });
  }
  const srd = SRD_MONSTER_LIST.map((m) => ({ key: `srd:monster:${m.id}`, name: m.name, detail: `SRD · CR ${m.cr}`, source: "srd" as const, hp: m.hp, ac: m.ac }));
  return [...custom, ...srd];
}

function freeName(folder: string, base: string): string {
  const clean = base.replace(/[\\/:*?"<>|#^[\]]/g, "-").trim() || "Creature";
  for (let n = 1; ; n++) {
    const name = n === 1 ? clean : `${clean} ${n}`;
    if (!checkName(folder, name, false)) return name;
  }
}

/** Creates a stat block note and opens it in Notes. */
export async function createStatblockNote(folder: string = STATS_FOLDER, sb: Statblock = emptyStatblock()): Promise<string | null> {
  try {
    const name = freeName(folder, sb.name);
    const path = await createNote(folder, name, newStatNote({ ...sb, name: sb.name === emptyStatblock().name ? name : sb.name }));
    openDoc({ kind: "note", path });
    return path;
  } catch (e) {
    useUi.getState().showToast(String(e instanceof Error ? e.message : e));
    return null;
  }
}

/** "Make a custom copy" of an SRD monster: an editable note in Stats/. */
export async function copyToCustomStatblock(sb: Statblock) {
  const { id: _id, ...rest } = sb as Statblock & { id?: string };
  const path = await createStatblockNote(STATS_FOLDER, { ...rest, description: "" });
  if (path) useUi.getState().showToast(`Created “${baseName(path)}” in ${dirOf(path) || "notes"} — edit it freely.`);
}
