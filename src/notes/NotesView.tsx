import { useEffect, useMemo, useRef, useState } from "react";
import { useDoc } from "../store/doc";
import { useUi } from "../store/ui";
import { FileTree, RenameInput } from "./FileTree";
import { LevelDocEditor, NoteEditor } from "./editors";
import { SearchPanel } from "./SearchPanel";
import { backlinksTo, docTitle, type Backlink } from "./links";
import { closeTab, createNote, docKey, navigateHistory, nameOf, openDoc, useNotes, type DocRef } from "./store";
import { fieldKey } from "./sources";
import type { Origin } from "./nav";

export function NotesView() {
  const sidebar = useNotes((s) => s.sidebar);
  const tabs = useNotes((s) => s.tabs);
  const activeTab = useNotes((s) => s.activeTab);
  const tab = tabs.find((t) => t.id === activeTab) ?? null;
  const [width, setWidth] = useState(() => {
    try {
      return Number(localStorage.getItem("notes.sidebar")) || 280;
    } catch {
      return 280;
    }
  });
  const drag = useRef<{ x: number; w: number } | null>(null);
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!drag.current) return;
      setWidth(Math.max(180, Math.min(560, drag.current.w + e.clientX - drag.current.x)));
    };
    const up = () => {
      if (!drag.current) return;
      drag.current = null;
      try {
        localStorage.setItem("notes.sidebar", String(width));
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [width]);

  return (
    <div className="notes-view">
      <aside className="notes-sidebar" style={{ width }}>
        <div className="sidebar-tabs">
          <button className={sidebar === "files" ? "on" : ""} onClick={() => useNotes.getState().set({ sidebar: "files" })}>
            Files
          </button>
          <button className={sidebar === "search" ? "on" : ""} onClick={() => useNotes.getState().set({ sidebar: "search" })} title="Search everything (⌘⇧F)">
            Search
          </button>
        </div>
        {sidebar === "files" ? <FileTree /> : <SearchPanel />}
        <div className="sidebar-resize" onMouseDown={(e) => (drag.current = { x: e.clientX, w: width })} />
      </aside>
      <section className="notes-main">
        <TabBar />
        {tab ? <DocPane key={docKey(tab.doc)} doc={tab.doc} origin="notes" /> : <EmptyNotes />}
      </section>
    </div>
  );
}

function EmptyNotes() {
  const newNote = async () => {
    try {
      openDoc({ kind: "note", path: await createNote("") });
    } catch (e) {
      useUi.getState().showToast(String(e));
    }
  };
  return (
    <div className="notes-empty">
      <p>No note open.</p>
      <p className="hint">
        Pick a note on the left, open one by name with <kbd>⌘O</kbd>, or search everything with <kbd>⌘⇧F</kbd>.
      </p>
      <button className="primary" onClick={() => void newNote()}>
        New note
      </button>
    </div>
  );
}

function TabBar() {
  const tabs = useNotes((s) => s.tabs);
  const activeTab = useNotes((s) => s.activeTab);
  useDoc((s) => s.dungeon?.levels); // level names in tab titles
  useNotes((s) => s.files);
  const tab = tabs.find((t) => t.id === activeTab);
  return (
    <div className="note-tabs">
      <button className="icon-btn" disabled={!tab?.back.length} onClick={() => navigateHistory("back")} title="Back (⌘⌥←)">
        ←
      </button>
      <button className="icon-btn" disabled={!tab?.forward.length} onClick={() => navigateHistory("forward")} title="Forward (⌘⌥→)">
        →
      </button>
      <div className="note-tabs-scroll">
        {tabs.map((t) => (
          <div
            key={t.id}
            className={`note-tab ${t.id === activeTab ? "active" : ""} ${t.doc.kind === "level" ? "level" : ""}`}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                closeTab(t.id);
              }
            }}
            onClick={() => useNotes.getState().set({ activeTab: t.id })}
            title={t.doc.kind === "note" ? t.doc.path : "Level document"}
          >
            <span className="note-tab-title" dir="auto">
              {t.doc.kind === "level" ? "🗺 " : ""}
              {docTitle(t.doc)}
            </span>
            <button
              className="note-tab-close"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(t.id);
              }}
              title="Close (⌘W)"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A note or level document with its title and backlinks. Also used by the peek panel. */
export function DocPane({ doc, origin }: { doc: DocRef; origin: Origin }) {
  const [renaming, setRenaming] = useState(false);
  const exists = useNotes((s) => (doc.kind === "note" ? s.files[doc.path] !== undefined : true));
  if (!exists) return <div className="note-missing">This note no longer exists.</div>;
  return (
    <div className="doc-pane">
      <div className="doc-scroll">
        {doc.kind === "note" && (
          <div className="doc-title-row">
            {renaming ? (
              <RenameInput path={doc.path} isFolder={false} onDone={() => setRenaming(false)} className="doc-title-rename" />
            ) : (
              <h1 className="doc-title" dir="auto" onClick={() => setRenaming(true)} title="Click to rename (links are updated)">
                {nameOf(doc.path)}
              </h1>
            )}
          </div>
        )}
        {doc.kind === "note" ? <NoteEditor path={doc.path} origin={origin} /> : <LevelDocEditor levelId={doc.levelId} origin={origin} />}
        <Backlinks doc={doc} origin={origin} />
      </div>
    </div>
  );
}

function Backlinks({ doc, origin }: { doc: DocRef; origin: Origin }) {
  const files = useNotes((s) => s.files);
  const dungeon = useDoc((s) => s.dungeon);
  const [open, setOpen] = useState(true);
  const links = useMemo(() => backlinksTo(doc), [doc, files, dungeon]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!links.length) return null;
  const go = (b: Backlink, newTab: boolean) => {
    const s = b.source;
    if (s.kind === "doc") {
      const range = { from: b.at, to: b.at };
      if (origin === "peek" && !newTab) useNotes.getState().set({ peek: s.doc });
      else openDoc(s.doc, { newTab, reveal: { range } });
      return;
    }
    const f = s.field;
    if (f.kind === "door" || f.kind === "object") {
      const target = { kind: f.kind, id: f.id } as const;
      useNotes.getState().set({ mainView: "dungeon" });
      useUi.getState().set({ currentLevelId: f.levelId, selection: target, zoomRequest: { target, nonce: Date.now() } });
      return;
    }
    openDoc({ kind: "level", levelId: f.levelId }, { newTab, reveal: { field: fieldKey(f), range: { from: b.at, to: b.at } } });
  };
  return (
    <div className="backlinks">
      <button className="backlinks-head" onClick={() => setOpen(!open)}>
        <span className={`tree-caret ${open ? "open" : ""}`}>›</span> Linked mentions ({links.length})
      </button>
      {open && (
        <ul>
          {links.map((b, i) => (
            <li key={i} onClick={(e) => go(b, e.metaKey || e.ctrlKey)}>
              <div className="backlink-source" dir="auto">
                {b.source.label}
              </div>
              <div className="backlink-snippet" dir="auto">
                {b.snippet}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
