/** The shared CodeMirror setup used by every markdown editor in the app. */
import type { Extension } from "@codemirror/state";
import { EditorView, drawSelection, dropCursor, keymap, placeholder as placeholderExt } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { HighlightStyle, foldKeymap, syntaxHighlighting } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { search, searchKeymap } from "@codemirror/search";
import { autocompletion, closeBrackets, completionKeymap } from "@codemirror/autocomplete";
import { tags as t } from "@lezer/highlight";
import { editorContext, type EditorContext } from "./context";
import { lineDirection, linkClicks, livePreview } from "./livePreview";
import { headingFolding } from "./folding";
import { formattingKeymap, imagePaste, wikiLinkCompletion } from "./commands";

const highlight = HighlightStyle.define([
  { tag: t.heading, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: "var(--md-syntax)" },
  { tag: t.url, color: "var(--md-syntax)" },
  { tag: t.link, color: "var(--md-link)" },
  { tag: t.monospace, fontFamily: "var(--mono)" },
  { tag: t.quote, color: "var(--md-quote)" },
]);

export interface EditorOptions {
  context: EditorContext;
  placeholder?: string;
  extra?: Extension[];
}

export function markdownEditorExtensions({ context, placeholder, extra = [] }: EditorOptions): Extension[] {
  return [
    editorContext.of(context),
    darkEditorTheme,
    history(),
    drawSelection(),
    dropCursor(),
    closeBrackets(),
    EditorView.lineWrapping,
    // Each line takes its direction from its own text (Hebrew right-to-left).
    EditorView.perLineTextDirection.of(true),
    markdown({ base: markdownLanguage, addKeymap: true }),
    syntaxHighlighting(highlight),
    livePreview,
    lineDirection,
    linkClicks,
    headingFolding(),
    search({ top: true }),
    autocompletion({ override: [wikiLinkCompletion], icons: false, activateOnTyping: true }),
    imagePaste,
    placeholder ? placeholderExt(placeholder) : [],
    keymap.of([
      ...formattingKeymap,
      ...completionKeymap,
      ...searchKeymap,
      ...foldKeymap,
      ...historyKeymap,
      indentWithTab,
      ...defaultKeymap,
    ]),
    ...extra,
  ];
}

/** Dark chrome for cursor, selection and panels (content styles live in styles.css). */
export const darkEditorTheme = EditorView.theme(
  {
    "&": { backgroundColor: "transparent" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#f0c46a" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection": {
      backgroundColor: "rgba(120, 150, 220, 0.3)",
    },
    ".cm-activeLine": { backgroundColor: "transparent" },
  },
  { dark: true },
);
