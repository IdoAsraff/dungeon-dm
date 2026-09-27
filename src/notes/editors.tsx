import { useEffect, useRef } from "react";
import { EditorSelection, EditorState, Transaction, type ChangeSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdownEditorExtensions } from "../editor/setup";
import { refreshDecorations } from "../editor/livePreview";
import { fieldContext, noteContext } from "../editor/appContext";
import { foldedHeadings, restoreFolds } from "../editor/folding";
import { External, InsertImageButton } from "../components/MarkdownEditor";
import { useDoc } from "../store/doc";
import { useUi } from "../store/ui";
import { docKey, setFolds, setNoteContent, useNotes, type DocRef, type Reveal } from "./store";
import { levelDocNames, levelHeadingTarget } from "./links";
import { composeLevelDoc, fieldTexts, layoutField, levelDocExtensions, levelDocSync, setLayout } from "./levelDoc";
import type { Origin } from "./nav";

/** Smallest single change turning `a` into `b` (keeps cursor and scroll stable). */
export function minimalChange(a: string, b: string): ChangeSpec | null {
  if (a === b) return null;
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  return { from: start, to: endA, insert: b.slice(start, endB) };
}

/** The element that scrolls an editor (the document pane, or the editor itself). */
function scroller(view: EditorView): HTMLElement {
  return (view.dom.closest(".doc-scroll") as HTMLElement | null) ?? view.scrollDOM;
}

/** Editor states per document, so switching tabs keeps undo history, cursor and scroll. */
const stateCache = new Map<string, { state: EditorState; scrollTop: number }>();

export function forgetEditorState(key: string) {
  stateCache.delete(key);
}

function useRevealHandler(view: React.RefObject<EditorView | null>, key: string, apply: (view: EditorView, r: Reveal) => void) {
  const reveal = useNotes((s) => s.reveal[key]);
  const lastNonce = useRef<number | null>(null);
  useEffect(() => {
    const v = view.current;
    if (!v || !reveal || reveal.nonce === lastNonce.current) return;
    lastNonce.current = reveal.nonce;
    // Wait a frame so a freshly mounted editor has measured itself.
    requestAnimationFrame(() => apply(v, reveal));
  }, [reveal, view, apply]);
}

function scrollToPos(view: EditorView, from: number, to = from, select = false) {
  view.dispatch({
    selection: select ? EditorSelection.range(from, to) : undefined,
    effects: EditorView.scrollIntoView(from, { y: "start", yMargin: 40 }),
  });
  if (select) view.focus();
}

function findHeadingLine(state: EditorState, heading: string): number | null {
  const h = heading.trim().toLowerCase();
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    const m = /^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line.text);
    if (m && m[1].toLowerCase() === h) return line.from;
  }
  return null;
}

// ---- notes ---------------------------------------------------------------------------

export function NoteEditor({ path, origin }: { path: string; origin: Origin }) {
  const doc: DocRef = { kind: "note", path };
  const key = docKey(doc);
  const text = useNotes((s) => s.files[path]);
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    const cached = stateCache.get(key);
    const content = useNotes.getState().files[path] ?? "";
    const state =
      cached && cached.state.doc.toString() === content
        ? cached.state
        : EditorState.create({
            doc: content,
            extensions: [
              markdownEditorExtensions({ context: noteContext(path, origin), placeholder: "Start writing… ([[ to link a note)" }),
              EditorView.updateListener.of((u) => {
                if (u.docChanged && !u.transactions.some((tr) => tr.annotation(External))) setNoteContent(path, u.state.doc.toString());
              }),
            ],
          });
    const view = new EditorView({ parent: host.current!, state });
    viewRef.current = view;
    if (cached && cached.state === state) {
      requestAnimationFrame(() => (scroller(view).scrollTop = cached.scrollTop));
    } else {
      restoreFolds(view, useNotes.getState().folds[key] ?? []);
    }
    return () => {
      stateCache.set(key, { state: view.state, scrollTop: scroller(view).scrollTop });
      setFolds(doc, foldedHeadings(view.state));
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, origin]);

  // Outside changes (link updates on rename, the same note open elsewhere).
  useEffect(() => {
    const view = viewRef.current;
    if (!view || text === undefined) return;
    const change = minimalChange(view.state.doc.toString(), text);
    if (change) view.dispatch({ changes: change, annotations: [External.of(true), Transaction.addToHistory.of(false)] });
  }, [text]);

  const indexVersion = useNotes((s) => s.indexVersion);
  useEffect(() => {
    viewRef.current?.dispatch({ effects: refreshDecorations.of(null) });
  }, [indexVersion]);

  useRevealHandler(viewRef, key, (view, r) => {
    if (r.range) return scrollToPos(view, r.range.from, r.range.to, true);
    if (r.heading) {
      const pos = findHeadingLine(view.state, r.heading);
      if (pos !== null) scrollToPos(view, pos);
    }
  });

  return (
    <div className="note-editor-wrap">
      <InsertImageButton view={viewRef} />
      <div className="note-editor" ref={host} />
    </div>
  );
}

// ---- level documents -------------------------------------------------------------------

const FIELD_COALESCE: Record<string, (id: string) => string> = {
  desc: (id) => `level-desc-${id}`,
  read: (id) => `room-read-${id}`,
  dm: (id) => `room-dm-${id}`,
};

function writeField(levelId: string, key: string, value: string) {
  const doc = useDoc.getState();
  if (key === "desc") return doc.updateLevel(levelId, { description: value }, FIELD_COALESCE.desc(levelId));
  const [kind, roomId] = key.split(":");
  if (kind === "read") doc.updateRoom(levelId, roomId, { readAloud: value }, FIELD_COALESCE.read(roomId));
  if (kind === "dm") doc.updateRoom(levelId, roomId, { dmNotes: value }, FIELD_COALESCE.dm(roomId));
}

export function LevelDocEditor({ levelId, origin }: { levelId: string; origin: Origin }) {
  const doc: DocRef = { kind: "level", levelId };
  const key = docKey(doc);
  const level = useDoc((s) => s.dungeon?.levels.find((l) => l.id === levelId));
  const name = useDoc((s) => levelDocNames(s.dungeon).get(levelId) ?? "Level");
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    const lvl = useDoc.getState().dungeon?.levels.find((l) => l.id === levelId);
    if (!lvl) return;
    const layout = composeLevelDoc(lvl, levelDocNames(useDoc.getState().dungeon).get(levelId) ?? lvl.name);
    const cached = stateCache.get(key);
    const reuse = cached && cached.state.doc.toString() === layout.text && cached.state.field(layoutField, false)?.signature === layout.signature;
    const state = reuse
      ? cached.state
      : EditorState.create({
          doc: layout.text,
          extensions: [
            markdownEditorExtensions({ context: fieldContext(origin) }),
            levelDocExtensions({
              onShowRoom: (roomId) => {
                const target = { kind: "room" as const, id: roomId };
                useNotes.getState().set({ mainView: "dungeon", peek: null });
                useUi.getState().set({ currentLevelId: levelId, selection: target, editingShape: false, draw: null, zoomRequest: { target, nonce: Date.now() } });
              },
              onBlockedEdit: () => useUi.getState().showToast("The structure of a level document is fixed — edit the text under each heading."),
            }),
            EditorView.updateListener.of((u) => {
              if (!u.docChanged || u.transactions.some((tr) => tr.annotation(External))) return;
              const before = fieldTexts(u.startState);
              for (const [k, v] of fieldTexts(u.state)) if (before.get(k) !== v) writeField(levelId, k, v);
            }),
          ],
        });
    const view = new EditorView({ parent: host.current!, state });
    if (!reuse) view.dispatch({ effects: setLayout.of(layout), annotations: [External.of(true), Transaction.addToHistory.of(false)] });
    viewRef.current = view;
    if (reuse) requestAnimationFrame(() => (scroller(view).scrollTop = cached!.scrollTop));
    else restoreFolds(view, useNotes.getState().folds[key] ?? []);
    return () => {
      stateCache.set(key, { state: view.state, scrollTop: scroller(view).scrollTop });
      setFolds(doc, foldedHeadings(view.state));
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, origin]);

  // Keep in sync with the level data (room panel edits, undo, renames, new rooms).
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !level) return;
    const layout = composeLevelDoc(level, name);
    const current = view.state.field(layoutField);
    const sync = [External.of(true), Transaction.addToHistory.of(false)];
    if (current.signature !== layout.signature) {
      // Structure changed: rebuild, keeping the cursor near where it was.
      const head = Math.min(view.state.selection.main.head, layout.text.length);
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: layout.text },
        selection: { anchor: head },
        effects: [setLayout.of(layout), levelDocSync.of(null)],
        annotations: sync,
      });
      return;
    }
    const texts = fieldTexts(view.state);
    const changes: ChangeSpec[] = [];
    for (const f of current.fields) {
      const want = layout.text.slice(layout.fields.find((x) => x.key === f.key)!.from, layout.fields.find((x) => x.key === f.key)!.to);
      const have = texts.get(f.key) ?? "";
      const c = minimalChange(have, want) as { from: number; to: number; insert: string } | null;
      if (c) changes.push({ from: f.from + c.from, to: f.from + c.to, insert: c.insert });
    }
    if (changes.length) view.dispatch({ changes, effects: levelDocSync.of(null), annotations: sync });
  }, [level, name]);

  const indexVersion = useNotes((s) => s.indexVersion);
  useEffect(() => {
    viewRef.current?.dispatch({ effects: refreshDecorations.of(null) });
  }, [indexVersion]);

  useRevealHandler(viewRef, key, (view, r) => {
    const { fields, locked } = view.state.field(layoutField);
    if (r.field) {
      const f = fields.find((x) => x.key === r.field);
      if (f && r.range) return scrollToPos(view, f.from + r.range.from, f.from + r.range.to, true);
      if (f) return scrollToPos(view, f.from);
    }
    if (r.range) return scrollToPos(view, r.range.from, r.range.to, true);
    if (r.heading && level) {
      const t = levelHeadingTarget(level, r.heading);
      const line =
        t?.kind === "room"
          ? locked.find((l) => l.roomId === t.roomId)
          : t?.kind === "section"
            ? locked.find((l) => l.kind === "section" && l.text.toLowerCase() === t.name)
            : null;
      if (line) scrollToPos(view, line.from);
    }
  });

  if (!level) return <div className="note-missing">This level no longer exists.</div>;
  return <div className="note-editor level-doc" ref={host} />;
}
