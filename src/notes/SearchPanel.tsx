import { useEffect, useMemo, useRef, useState } from "react";
import { useDoc } from "../store/doc";
import { useUi } from "../store/ui";
import { globalSearch, type SearchResult } from "./search";
import { openDoc, useNotes } from "./store";

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function openResult(r: SearchResult, matchIndex: number, newTab: boolean) {
  const m = r.matches[matchIndex];
  const range = m ? { from: m.from, to: m.to } : undefined;
  const t = r.target;
  if (t.kind === "note") return openDoc({ kind: "note", path: t.path }, { newTab, reveal: range ? { range } : undefined });
  if (t.kind === "level-field") return openDoc({ kind: "level", levelId: t.levelId }, { newTab, reveal: { field: t.field, range } });
  const ref = t.ref;
  if (ref.kind === "door" || ref.kind === "object") {
    const target = { kind: ref.kind, id: ref.id } as const;
    useNotes.getState().set({ mainView: "dungeon" });
    useUi.getState().set({ currentLevelId: ref.levelId, selection: target, editingShape: false, zoomRequest: { target, nonce: Date.now() } });
  }
}

/** ⌘⇧F: search notes, level documents and door/object descriptions. */
export function SearchPanel() {
  const query = useNotes((s) => s.searchQuery);
  const files = useNotes((s) => s.files);
  const dungeon = useDoc((s) => s.dungeon);
  const input = useRef<HTMLInputElement>(null);
  const q = useDebounced(query, 150);
  const results = useMemo(() => globalSearch(q, files, dungeon), [q, files, dungeon]);
  const total = results.reduce((n, r) => n + r.matches.length, 0);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  // Re-focus when ⌘⇧F is pressed again while the panel is open.
  const focusNonce = useNotes((s) => s.searchFocus);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusNonce]);

  return (
    <div className="search-panel">
      <input
        ref={input}
        className="search-input"
        dir="auto"
        placeholder="Search notes, rooms, doors…"
        value={query}
        onChange={(e) => useNotes.getState().set({ searchQuery: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === "Enter" && results[0]) openResult(results[0], 0, false);
        }}
      />
      {q.trim() && (
        <div className="search-summary">
          {total} match{total === 1 ? "" : "es"} in {results.length} place{results.length === 1 ? "" : "s"}
        </div>
      )}
      <div className="search-results">
        {results.map((r) => {
          const isCollapsed = collapsed.has(r.key);
          return (
            <div key={r.key} className="search-result">
              <div
                className="search-result-title"
                dir="auto"
                onClick={(e) => (r.matches.length ? setCollapsed((c) => new Set(c.has(r.key) ? [...c].filter((k) => k !== r.key) : [...c, r.key])) : openResult(r, -1, e.metaKey))}
              >
                <span className={`tree-caret ${isCollapsed ? "" : "open"}`}>{r.matches.length ? "›" : ""}</span>
                <span className="grow">
                  {r.target.kind === "note" ? "📝 " : r.target.kind === "map" ? "🚪 " : "🗺 "}
                  {r.title}
                </span>
                {r.matches.length > 0 && <span className="search-count">{r.matches.length}</span>}
              </div>
              {!isCollapsed &&
                r.matches.map((m, i) => (
                  <div key={i} className="search-match" dir="auto" onClick={(e) => openResult(r, i, e.metaKey || e.ctrlKey)}>
                    {m.before}
                    <mark>{m.match}</mark>
                    {m.after}
                  </div>
                ))}
            </div>
          );
        })}
        {q.trim() && results.length === 0 && <p className="hint">No matches.</p>}
        {!q.trim() && (
          <p className="hint">
            Matches ignore upper/lower case and Hebrew vowel marks. Click a tag like <code>#npc</code> in a note to search for it.
          </p>
        )}
      </div>
    </div>
  );
}
