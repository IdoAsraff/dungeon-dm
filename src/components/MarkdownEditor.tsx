import { useEffect, useRef } from "react";
import { Annotation, EditorState, Transaction, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdownEditorExtensions } from "../editor/setup";
import { refreshDecorations } from "../editor/livePreview";
import { fieldContext } from "../editor/appContext";
import { getContext, type EditorContext } from "../editor/context";
import { useNotes } from "../notes/store";
import { useUi } from "../store/ui";

/** Marks transactions that sync outside changes into the editor (not user edits). */
export const External = Annotation.define<boolean>();

interface Props {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  /** Extra class for sizing (e.g. "tall"). */
  className?: string;
  autoFocus?: boolean;
  /** Defaults to a dungeon text field opened from the dungeon tab. */
  context?: EditorContext;
  extensions?: Extension[];
}

/** Obsidian-style live-preview markdown editor (CodeMirror 6). */
export function MarkdownEditor({ value, onChange, placeholder, className, autoFocus, context, extensions = [] }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          markdownEditorExtensions({ context: context ?? fieldContext("dungeon"), placeholder, extra: extensions }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !u.transactions.some((tr) => tr.annotation(External))) onChangeRef.current(u.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    if (autoFocus) view.focus();
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // The editor is created once; `key` the component to start over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Outside changes (undo/redo, the same text edited elsewhere) replace the content.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      annotations: [External.of(true), Transaction.addToHistory.of(false)],
    });
  }, [value]);

  // Redraw links/images when notes or the dungeon folder change.
  const indexVersion = useNotes((s) => s.indexVersion);
  const dir = useUi((s) => s.dungeonDir);
  useEffect(() => {
    viewRef.current?.dispatch({ effects: refreshDecorations.of(null) });
  }, [indexVersion, dir]);

  return (
    <div className={`md-editor ${className ?? ""}`}>
      <div className="md-host" ref={host} />
      <InsertImageButton view={viewRef} />
    </div>
  );
}

/** Picks an image file and inserts it at the cursor (pasting and dropping work too). */
export function InsertImageButton({ view }: { view: React.RefObject<EditorView | null> }) {
  return (
    <button
      type="button"
      className="md-insert-image"
      title="Insert an image (you can also paste or drop one)"
      onMouseDown={(e) => e.preventDefault()}
      onClick={async () => {
        const v = view.current;
        if (!v) return;
        try {
          const md = await getContext(v.state).pickImage();
          if (md) v.dispatch(v.state.replaceSelection(md));
        } catch (err) {
          useUi.getState().showToast(`Could not add image: ${err}`);
        }
      }}
    >
      🖼
    </button>
  );
}
