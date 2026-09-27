import { useEffect, useMemo, useRef, useState } from "react";
import { useDoc } from "../store/doc";
import { useUi } from "../store/ui";
import { baseName } from "../lib/wikiLinks";
import { normalizeForSearch } from "./search";
import { levelDocNames } from "./links";
import { LEVELS_FOLDER, createNote, dirOf, openDoc, useNotes, type DocRef } from "./store";

interface Item {
  doc: DocRef;
  name: string;
  folder: string;
}

/** Scores a fuzzy match of `q` in `s` (subsequence); higher is better, -1 = no match. */
export function fuzzyScore(s: string, q: string): number {
  const a = normalizeForSearch(s).norm;
  const b = normalizeForSearch(q).norm;
  if (!b) return 0;
  const direct = a.indexOf(b);
  if (direct !== -1) return 1000 - direct * 2 - (a.length - b.length);
  let i = 0;
  let score = 0;
  let last = -1;
  for (const ch of b) {
    const at = a.indexOf(ch, i);
    if (at === -1) return -1;
    score += at === last + 1 ? 5 : 1;
    last = at;
    i = at + 1;
  }
  return score - a.length * 0.1;
}

/** ⌘O: open any note or level document by typing part of its name. */
export function QuickSwitcher() {
  const open = useNotes((s) => s.quickSwitcher);
  if (!open) return null;
  return <QuickSwitcherModal />;
}

function QuickSwitcherModal() {
  const files = useNotes((s) => s.files);
  const dungeon = useDoc((s) => s.dungeon);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const close = () => useNotes.getState().set({ quickSwitcher: false });

  const items: Item[] = useMemo(() => {
    const notes = Object.keys(files).map((p) => ({ doc: { kind: "note", path: p } as DocRef, name: baseName(p), folder: dirOf(p) }));
    const levels = [...levelDocNames(dungeon)].map(([id, name]) => ({ doc: { kind: "level", levelId: id } as DocRef, name, folder: LEVELS_FOLDER }));
    return [...levels, ...notes];
  }, [files, dungeon]);

  const shown = useMemo(() => {
    if (!q.trim()) return items.slice(0, 50);
    return items
      .map((it) => ({ it, s: Math.max(fuzzyScore(it.name, q), fuzzyScore(`${it.folder}/${it.name}`, q) - 50) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 50)
      .map((x) => x.it);
  }, [items, q]);
  const canCreate = q.trim() && !items.some((it) => it.name.toLowerCase() === q.trim().toLowerCase());
  const count = shown.length + (canCreate ? 1 : 0);

  const choose = async (index: number, newTab: boolean) => {
    close();
    if (index < shown.length) return openDoc(shown[index].doc, { newTab });
    try {
      const path = await createNote("", q.trim());
      openDoc({ kind: "note", path }, { newTab });
    } catch (e) {
      useUi.getState().showToast(String(e instanceof Error ? e.message : e));
    }
  };

  return (
    <div className="modal-backdrop quick-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="quick-switcher">
        <input
          ref={input}
          dir="auto"
          value={q}
          placeholder="Open a note or level document…"
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(count - 1, s + 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(0, s - 1));
            }
            if (e.key === "Enter" && count) void choose(sel, e.metaKey || e.ctrlKey);
          }}
        />
        <ul>
          {shown.map((it, i) => (
            <li key={`${it.folder}/${it.name}`} className={i === sel ? "sel" : ""} onMouseEnter={() => setSel(i)} onClick={(e) => void choose(i, e.metaKey || e.ctrlKey)}>
              <span dir="auto">
                {it.doc.kind === "level" ? "🗺 " : ""}
                {it.name}
              </span>
              {it.folder && <span className="quick-folder">{it.folder}</span>}
            </li>
          ))}
          {canCreate && (
            <li className={sel === shown.length ? "sel" : ""} onMouseEnter={() => setSel(shown.length)} onClick={() => void choose(shown.length, false)}>
              <span>
                ＋ Create note “<span dir="auto">{q.trim()}</span>”
              </span>
            </li>
          )}
        </ul>
        <div className="quick-hint">↵ open · ⌘↵ new tab · esc close</div>
      </div>
    </div>
  );
}
