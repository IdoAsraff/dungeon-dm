/** Formatting shortcuts, image paste/drop and [[ link completion. */
import { EditorSelection } from "@codemirror/state";
import { EditorView, type KeyBinding } from "@codemirror/view";
import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { getContext } from "./context";

/** Wraps (or unwraps) every selection with `mark` on both sides. */
function toggleWrap(mark: string) {
  return (view: EditorView) => {
    const { state } = view;
    const tr = state.changeByRange((range) => {
      const n = mark.length;
      const before = state.sliceDoc(range.from - n, range.from);
      const after = state.sliceDoc(range.to, range.to + n);
      if (before === mark && after === mark) {
        return {
          changes: [
            { from: range.from - n, to: range.from, insert: "" },
            { from: range.to, to: range.to + n, insert: "" },
          ],
          range: EditorSelection.range(range.from - n, range.to - n),
        };
      }
      return {
        changes: [
          { from: range.from, insert: mark },
          { from: range.to, insert: mark },
        ],
        range: EditorSelection.range(range.from + n, range.to + n),
      };
    });
    view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: "input" }));
    return true;
  };
}

function insertLink(view: EditorView) {
  const { state } = view;
  const tr = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to) || "link";
    const insert = `[${text}](https://)`;
    const urlFrom = range.from + text.length + 3;
    return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.range(urlFrom, urlFrom + 8) };
  });
  view.dispatch(tr);
  return true;
}

export const formattingKeymap: KeyBinding[] = [
  { key: "Mod-b", run: toggleWrap("**") },
  { key: "Mod-i", run: toggleWrap("*") },
  { key: "Mod-Shift-x", run: toggleWrap("~~") },
  { key: "Mod-k", run: insertLink },
];

function imageFiles(list: FileList | null | undefined): File[] {
  return Array.from(list ?? []).filter((f) => f.type.startsWith("image/"));
}

async function insertImages(view: EditorView, files: File[], pos: number | null) {
  const ctx = getContext(view.state);
  const parts: string[] = [];
  for (const f of files) {
    try {
      const md = await ctx.saveImage(f);
      if (md) parts.push(md);
    } catch (e) {
      console.error("could not store image", e);
    }
  }
  if (!parts.length) return;
  const insert = parts.join("\n");
  if (pos === null) view.dispatch(view.state.replaceSelection(insert));
  else view.dispatch({ changes: { from: pos, insert }, selection: { anchor: pos + insert.length } });
}

/** Pasting or dropping image files stores them and inserts an embed. */
export const imagePaste = EditorView.domEventHandlers({
  paste(e, view) {
    const files = imageFiles(e.clipboardData?.files);
    if (!files.length) return false;
    e.preventDefault();
    void insertImages(view, files, null);
    return true;
  },
  drop(e, view) {
    const files = imageFiles(e.dataTransfer?.files);
    if (!files.length) return false;
    e.preventDefault();
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    void insertImages(view, files, pos);
    return true;
  },
});

/** `[[` completes note names, `[[Note#` completes its headings. */
export function wikiLinkCompletion(context: CompletionContext): CompletionResult | null {
  const before = context.matchBefore(/!?\[\[[^[\]\n]*$/);
  if (!before) return null;
  const ctx = getContext(context.state);
  const start = before.text.indexOf("[[") + 2;
  const typed = before.text.slice(start);
  const after = context.state.sliceDoc(context.pos, context.pos + 2);
  const close = after === "]]" ? "" : "]]";
  const hash = typed.indexOf("#");
  if (hash !== -1) {
    const target = typed.slice(0, hash);
    return {
      from: before.from + start + hash + 1,
      options: ctx.headingCompletions(target).map((c) => ({ label: c.label, detail: c.detail, apply: c.label + close })),
      validFor: /^[^[\]\n#|]*$/,
    };
  }
  return {
    from: before.from + start,
    options: ctx.linkCompletions().map((c) => ({ label: c.label, detail: c.detail, apply: c.label + close })),
    validFor: /^[^[\]\n#|]*$/,
  };
}
