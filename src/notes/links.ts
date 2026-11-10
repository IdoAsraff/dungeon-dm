/**
 * Link index over notes and level documents: resolving [[links]],
 * completions, backlinks and keeping links intact when things are renamed.
 */
import { LinkIndex, formatWikiLink, parseWikiLinks, rewriteLinks, safeFileName, baseName, type LinkTarget } from "../lib/wikiLinks";
import { roomTitle, type Dungeon, type Level } from "../types";
import { useDoc } from "../store/doc";
import { LEVELS_FOLDER, dirOf, docKey, movePath, setNoteContent, useNotes, type DocRef } from "./store";
import { dungeonTexts, sortedRooms, type FieldRef } from "./sources";
import { srdDocTitle, srdLinkTargets } from "../rules/srd";

/** File-like name of each level's document (unique, safe for links). */
export function levelDocNames(dungeon: Dungeon | null): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  for (const level of dungeon?.levels ?? []) {
    const base = safeFileName(level.name);
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} (${n})`;
    used.add(name.toLowerCase());
    out.set(level.id, name);
  }
  return out;
}

let cache: { files: object; dungeon: unknown; index: LinkIndex } | null = null;

export function linkIndex(): LinkIndex {
  const files = useNotes.getState().files;
  const dungeon = useDoc.getState().dungeon;
  if (cache && cache.files === files && cache.dungeon === dungeon) return cache.index;
  cache = { files, dungeon, index: buildIndex(Object.keys(files), dungeon) };
  return cache.index;
}

export function buildIndex(notePaths: string[], dungeon: Dungeon | null): LinkIndex {
  const targets: LinkTarget[] = notePaths.map((p) => ({ id: `note:${p}`, path: p.replace(/\.md$/i, "") }));
  for (const [levelId, name] of levelDocNames(dungeon)) targets.push({ id: `level:${levelId}`, path: `${LEVELS_FOLDER}/${name}` });
  targets.push(...srdLinkTargets());
  return new LinkIndex(targets);
}

export function refFromId(id: string): DocRef | null {
  if (id.startsWith("note:")) return { kind: "note", path: id.slice(5) };
  if (id.startsWith("level:")) return { kind: "level", levelId: id.slice(6) };
  if (id.startsWith("srd:")) return { kind: "srd", id: id.slice(4) };
  return null;
}

export function resolveLink(target: string): DocRef | null {
  const t = linkIndex().resolve(target);
  return t ? refFromId(t.id) : null;
}

export function docTitle(ref: DocRef): string {
  if (ref.kind === "note") return baseName(ref.path);
  if (ref.kind === "srd") return srdDocTitle(ref.id);
  return levelDocNames(useDoc.getState().dungeon).get(ref.levelId) ?? "Level";
}

// ---- completions ---------------------------------------------------------------

export function linkCompletions() {
  const idx = linkIndex();
  return idx.targets.map((t) => {
    const folder = dirOf(t.path);
    return { label: idx.linkTextFor(t), detail: folder || undefined };
  });
}

function noteHeadings(text: string): string[] {
  const out: string[] = [];
  let fence = false;
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const m = !fence && /^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (m && m[1]) out.push(m[1]);
  }
  return out;
}

export function headingCompletions(target: string) {
  const ref = resolveLink(target);
  if (!ref) return [];
  if (ref.kind === "note") return noteHeadings(useNotes.getState().files[ref.path] ?? "").map((h) => ({ label: h }));
  if (ref.kind === "srd") return [];
  const level = useDoc.getState().dungeon?.levels.find((l) => l.id === ref.levelId);
  if (!level) return [];
  return [
    { label: "Background" },
    { label: "Rooms" },
    ...sortedRooms(level).map((r) => ({ label: r.label, detail: roomTitle(r) })),
  ];
}

/**
 * Which room (or section) of a level a heading points to: "Background", "Rooms",
 * a room label ("42", "2-17C"), a room heading ("2-17C · The Throne Hall") or a room title.
 */
export function levelHeadingTarget(level: Level, heading: string | null): { kind: "room"; roomId: string } | { kind: "section"; name: "background" | "rooms" } | null {
  if (!heading) return null;
  const h = heading.trim().toLowerCase();
  if (h === "background") return { kind: "section", name: "background" };
  if (h === "rooms") return { kind: "section", name: "rooms" };
  const byLabel = level.rooms.find((r) => r.label.toLowerCase() === h);
  // "<label> · <title>" (or a label followed by more words): the longest label that starts the heading.
  const byPrefix = byLabel
    ? undefined
    : level.rooms
        .filter((r) => h.startsWith(r.label.toLowerCase()) && /^\s|^$/.test(h.slice(r.label.length)))
        .sort((a, b) => b.label.length - a.label.length)[0];
  const room = byLabel ?? byPrefix ?? level.rooms.find((r) => roomTitle(r).toLowerCase() === h);
  return room ? { kind: "room", roomId: room.id } : null;
}

// ---- backlinks ----------------------------------------------------------------

export type LinkSource = { kind: "doc"; doc: DocRef; label: string } | { kind: "field"; field: FieldRef; label: string };

export interface Backlink {
  source: LinkSource;
  /** The line containing the link. */
  snippet: string;
  /** Offset of the link within the source text. */
  at: number;
}

function lineAround(text: string, at: number): string {
  const start = text.lastIndexOf("\n", at - 1) + 1;
  const end = text.indexOf("\n", at);
  return text.slice(start, end === -1 ? undefined : end).trim();
}

export function backlinksTo(ref: DocRef): Backlink[] {
  const idx = linkIndex();
  const id = docKey(ref);
  const out: Backlink[] = [];
  const scan = (text: string, source: LinkSource) => {
    for (const l of parseWikiLinks(text)) if (!l.embed && idx.resolve(l.target)?.id === id) out.push({ source, snippet: lineAround(text, l.from), at: l.from });
  };
  const files = useNotes.getState().files;
  for (const path of Object.keys(files).sort()) {
    if (ref.kind === "note" && ref.path === path) continue;
    scan(files[path], { kind: "doc", doc: { kind: "note", path }, label: baseName(path) });
  }
  for (const t of dungeonTexts(useDoc.getState().dungeon)) {
    if (ref.kind === "level" && t.ref.levelId === ref.levelId && t.ref.kind !== "door" && t.ref.kind !== "object") continue;
    scan(t.text, { kind: "field", field: t.ref, label: t.label });
  }
  return out;
}

// ---- keeping links intact on rename -------------------------------------------------

/** Applies `rewrite` to every note and every dungeon text field. */
function rewriteEverywhere(rewrite: (text: string) => string) {
  const files = useNotes.getState().files;
  for (const [path, text] of Object.entries(files)) {
    const next = rewrite(text);
    if (next !== text) setNoteContent(path, next);
  }
  useDoc.getState().mapTexts((text) => rewrite(text));
}

/** Renames/moves a note or folder and updates every link pointing into it. */
export async function moveWithLinks(from: string, to: string) {
  const oldIndex = linkIndex();
  const oldFiles = Object.keys(useNotes.getState().files);
  const moved = oldFiles.filter((p) => p === from || p.startsWith(from + "/"));
  await movePath(from, to);
  const newIndex = linkIndex();
  const renames = moved.map((p) => {
    const np = to + p.slice(from.length);
    const target = newIndex.targets.find((t) => t.id === `note:${np}`)!;
    return { oldId: `note:${p}`, newText: newIndex.linkTextFor(target) };
  });
  rewriteEverywhere((text) => renames.reduce((acc, r) => rewriteLinks(acc, oldIndex, r.oldId, r.newText), text));
}

/**
 * Call after a level was renamed: links to its document used the old name.
 * `oldDungeon` is the dungeon before the rename.
 */
export function relinkRenamedLevel(levelId: string, oldDungeon: Dungeon) {
  const oldIndex = buildIndex(Object.keys(useNotes.getState().files), oldDungeon);
  const newIndex = linkIndex();
  const target = newIndex.targets.find((t) => t.id === `level:${levelId}`);
  if (!target) return;
  const newText = newIndex.linkTextFor(target);
  rewriteEverywhere((text) => rewriteLinks(text, oldIndex, `level:${levelId}`, newText));
}

/**
 * Call after a room's label changed: links to the room by its old label
 * (`[[Level 2#173]]`, `[[Level 2#173 · Throne Hall]]`) now use the new one.
 * Links by room title still work and are left alone.
 */
export function relinkRelabeledRoom(levelId: string, roomId: string, oldLabel: string, newLabel: string) {
  const dungeon = useDoc.getState().dungeon;
  const level = dungeon?.levels.find((l) => l.id === levelId);
  if (!level || oldLabel === newLabel) return;
  const oldLevel: Level = { ...level, rooms: level.rooms.map((r) => (r.id === roomId ? { ...r, label: oldLabel } : r)) };
  const index = linkIndex();
  rewriteEverywhere((text) => relabelLinks(text, (target) => index.resolve(target)?.id === `level:${levelId}`, oldLevel, roomId, oldLabel, newLabel));
}

/** Rewrites, in `text`, links into `oldLevel` (per `isLevel`) whose heading is the room's old label. Pure; exported for tests. */
export function relabelLinks(text: string, isLevel: (target: string) => boolean, oldLevel: Level, roomId: string, oldLabel: string, newLabel: string): string {
  let out = "";
  let last = 0;
  for (const l of parseWikiLinks(text)) {
    if (!l.heading || !isLevel(l.target)) continue;
    const t = levelHeadingTarget(oldLevel, l.heading);
    if (t?.kind !== "room" || t.roomId !== roomId) continue;
    const h = l.heading.trim();
    if (!h.toLowerCase().startsWith(oldLabel.toLowerCase())) continue; // linked by title
    // Shown text that is just the old label ("[[Level 2#173|173]]") follows too.
    const alias = l.alias && l.alias.trim().toLowerCase() === oldLabel.toLowerCase() ? newLabel : l.alias;
    out += text.slice(last, l.from) + formatWikiLink({ ...l, heading: newLabel + h.slice(oldLabel.length), alias });
    last = l.to;
  }
  return last ? out + text.slice(last) : text;
}
