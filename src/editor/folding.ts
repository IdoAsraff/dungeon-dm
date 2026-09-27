/**
 * Folding under headings (like Obsidian): a heading folds everything up to
 * the next heading of the same or a higher level. Level documents supply
 * their own outline levels for their fixed lines through `outlineLevel`.
 */
import { Facet, type EditorState, type Line } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import {
  codeFolding,
  foldEffect,
  foldGutter,
  foldService,
  foldable,
  foldedRanges,
  syntaxTree,
  unfoldEffect,
} from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { headingOffset } from "./context";

type LevelFn = (state: EditorState, line: Line) => number | null;

/** Markdown ATX heading level (plus the heading offset), or null. */
export function markdownHeadingLevel(state: EditorState, line: Line): number | null {
  const m = /^ {0,3}(#{1,6})(?:[ \t]|$)/.exec(line.text);
  if (!m) return null;
  // Ignore "# comments" inside code blocks.
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(line.from, 1); n; n = n.parent)
    if (n.name === "FencedCode" || n.name === "CodeBlock") return null;
  return m[1].length + state.facet(headingOffset)(state, line.from);
}

/** Outline level of a line; overridable (level documents). */
export const outlineLevel = Facet.define<LevelFn, LevelFn>({
  combine: (values) => values[values.length - 1] ?? markdownHeadingLevel,
});

function headingFold(state: EditorState, lineStart: number) {
  const levelOf = state.facet(outlineLevel);
  const doc = state.doc;
  const line = doc.lineAt(lineStart);
  const level = levelOf(state, line);
  if (level === null) return null;
  let end = line.to;
  for (let n = line.number + 1; n <= doc.lines; n++) {
    const next = doc.line(n);
    const l = levelOf(state, next);
    if (l !== null && l <= level) break;
    if (next.text.trim() !== "") end = next.to;
  }
  return end > line.to ? { from: line.to, to: end } : null;
}

function chevron(open: boolean) {
  const s = document.createElement("span");
  s.className = `cm-fold-chevron ${open ? "open" : "closed"}`;
  s.textContent = "›";
  return s;
}

/** When search or navigation puts the cursor inside a fold, open it. */
const autoUnfold = EditorView.updateListener.of((u: ViewUpdate) => {
  if (!u.selectionSet) return;
  const effects: ReturnType<typeof unfoldEffect.of>[] = [];
  foldedRanges(u.state).between(0, u.state.doc.length, (from, to) => {
    for (const r of u.state.selection.ranges) if (r.head > from && r.head <= to) effects.push(unfoldEffect.of({ from, to }));
  });
  if (effects.length) queueMicrotask(() => u.view.dispatch({ effects }));
});

export function headingFolding() {
  return [
    foldService.of((state, from) => headingFold(state, from)),
    codeFolding({ placeholderText: "…" }),
    foldGutter({ markerDOM: chevron }),
    autoUnfold,
  ];
}

/** Text of every folded heading line (to remember folds between sessions). */
export function foldedHeadings(state: EditorState): string[] {
  const out: string[] = [];
  foldedRanges(state).between(0, state.doc.length, (from) => {
    out.push(state.doc.lineAt(from).text);
  });
  return out;
}

/** Folds the headings whose line text is in `texts`. */
export function restoreFolds(view: EditorView, texts: string[]) {
  if (!texts.length) return;
  const wanted = new Set(texts);
  const effects = [];
  const doc = view.state.doc;
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (!wanted.has(line.text)) continue;
    const range = foldable(view.state, line.from, line.to);
    if (range) effects.push(foldEffect.of(range));
  }
  if (effects.length) view.dispatch({ effects });
}
