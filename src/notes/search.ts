/**
 * Global search (⌘⇧F) over notes, level documents (level backgrounds and
 * room texts) and door/object descriptions. Matching ignores case, accents
 * and Hebrew vowel marks (niqqud).
 */
import type { Dungeon } from "../types";
import { baseName } from "../lib/wikiLinks";
import { dungeonTexts, fieldKey, type FieldRef } from "./sources";

/** Normalized text plus a map from normalized offsets back to original offsets. */
export function normalizeForSearch(text: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const folded = text[i].normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    for (const ch of folded) {
      norm += ch;
      map.push(i);
    }
  }
  map.push(text.length);
  return { norm, map };
}

export interface Match {
  from: number;
  to: number;
  before: string;
  match: string;
  after: string;
}

export function findMatches(text: string, query: string, limit = 50): Match[] {
  const q = normalizeForSearch(query.trim()).norm;
  if (!q) return [];
  const { norm, map } = normalizeForSearch(text);
  const out: Match[] = [];
  for (let at = norm.indexOf(q); at !== -1 && out.length < limit; at = norm.indexOf(q, at + q.length)) {
    const from = map[at];
    const to = map[at + q.length - 1] + 1;
    const lineStart = text.lastIndexOf("\n", from - 1) + 1;
    const lineEndRaw = text.indexOf("\n", to);
    const lineEnd = lineEndRaw === -1 ? text.length : lineEndRaw;
    const before = text.slice(Math.max(lineStart, from - 60), from);
    const after = text.slice(to, Math.min(lineEnd, to + 80));
    out.push({ from, to, before: (from - 60 > lineStart ? "…" : "") + before, match: text.slice(from, to), after });
  }
  return out;
}

export type SearchTarget =
  | { kind: "note"; path: string }
  | { kind: "level-field"; levelId: string; field: string }
  | { kind: "map"; ref: FieldRef };

export interface SearchResult {
  key: string;
  title: string;
  target: SearchTarget;
  titleMatch: boolean;
  matches: Match[];
}

export function globalSearch(query: string, files: Record<string, string>, dungeon: Dungeon | null): SearchResult[] {
  if (!normalizeForSearch(query.trim()).norm) return [];
  const results: SearchResult[] = [];
  for (const path of Object.keys(files).sort()) {
    const titleMatch = findMatches(baseName(path), query, 1).length > 0;
    const matches = findMatches(files[path], query);
    if (titleMatch || matches.length) results.push({ key: `note:${path}`, title: path.replace(/\.md$/i, ""), target: { kind: "note", path }, titleMatch, matches });
  }
  for (const t of dungeonTexts(dungeon)) {
    const matches = findMatches(t.text, query);
    if (!matches.length) continue;
    const target: SearchTarget =
      t.ref.kind === "door" || t.ref.kind === "object"
        ? { kind: "map", ref: t.ref }
        : { kind: "level-field", levelId: t.ref.levelId, field: fieldKey(t.ref) };
    results.push({ key: `${t.ref.kind}:${fieldKey(t.ref)}:${t.ref.levelId}`, title: t.label, target, titleMatch: false, matches });
  }
  // Note-title matches first, then by number of matches.
  return results.sort((a, b) => Number(b.titleMatch) - Number(a.titleMatch) || b.matches.length - a.matches.length);
}
