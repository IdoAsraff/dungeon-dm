/**
 * Markdown tables (GFM pipe tables) are shown as real tables unless the cursor
 * is inside one, where the raw text is shown for editing (like the rest of the
 * live preview). Clicking a rendered table puts the cursor in it; clicking a
 * link in a cell follows the link.
 *
 * Replacing whole lines with a block widget must come from a state field, not a
 * view plugin, so this lives next to `livePreview` rather than inside it.
 */
import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension, type Range, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { getContext } from "./context";
import { parseWikiLinks } from "../lib/wikiLinks";

export type Align = "left" | "center" | "right" | null;

export interface ParsedTable {
  header: string[];
  align: Align[];
  rows: string[][];
}

/** Splits one table row into cell texts (outer pipes optional, `\|` is a literal pipe, pipes inside [[...]] or `code` don't split). */
export function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  let depth = 0;
  let code = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
      continue;
    }
    if (c === "`") code = !code;
    if (!code && s.startsWith("[[", i)) depth++;
    if (!code && s.startsWith("]]", i) && depth > 0) depth--;
    if (c === "|" && depth === 0 && !code) {
      cells.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

/** Parses a GFM table; null if the text isn't one (needs a header and a `---` delimiter row). */
export function parseTable(text: string): ParsedTable | null {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return null;
  const delim = splitRow(lines[1]);
  if (!delim.every((d) => /^:?-+:?$/.test(d))) return null;
  const align: Align[] = delim.map((d) => (d.startsWith(":") && d.endsWith(":") ? "center" : d.endsWith(":") ? "right" : d.startsWith(":") ? "left" : null));
  const header = splitRow(lines[0]);
  const width = header.length;
  const fit = (cells: string[]) => [...cells, ...Array(Math.max(0, width - cells.length)).fill("")].slice(0, width);
  return { header, align: fit(align as string[]) as Align[], rows: lines.slice(2).map((l) => fit(splitRow(l))) };
}

// ---- rendering cell text --------------------------------------------------------------

const INLINE = /(\[\[[^\]]+\]\])|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\s][^*]*\*)|(_[^_\s][^_]*_)|(~~[^~]+~~)|(`[^`]+`)|(\[[^\]]+\]\([^)\s]+\))/;

/** Appends the cell's markdown (bold, italics, strike, code, [[links]], [text](url)) to `parent` as DOM nodes. */
function renderInline(parent: HTMLElement, text: string, state: EditorState) {
  let rest = text;
  while (rest) {
    const m = INLINE.exec(rest);
    if (!m) {
      parent.append(rest);
      return;
    }
    if (m.index > 0) parent.append(rest.slice(0, m.index));
    const tok = m[0];
    if (m[1]) {
      const [l] = parseWikiLinks(tok);
      const a = document.createElement("span");
      a.className = getContext(state).linkExists(l.target) ? "cm-wikilink" : "cm-wikilink cm-wikilink-missing";
      a.dataset.target = l.target;
      a.dataset.heading = l.heading ?? "";
      a.textContent = l.alias ?? (l.heading ? `${l.target} › ${l.heading}` : l.target);
      parent.append(a);
    } else if (m[2] || m[3]) {
      const b = document.createElement("strong");
      renderInline(b, tok.slice(2, -2), state);
      parent.append(b);
    } else if (m[4] || m[5]) {
      const em = document.createElement("em");
      renderInline(em, tok.slice(1, -1), state);
      parent.append(em);
    } else if (m[6]) {
      const s = document.createElement("s");
      renderInline(s, tok.slice(2, -2), state);
      parent.append(s);
    } else if (m[7]) {
      const c = document.createElement("code");
      c.className = "cm-inline-code";
      c.textContent = tok.slice(1, -1);
      parent.append(c);
    } else {
      const mm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok)!;
      const a = document.createElement("span");
      a.className = "cm-link";
      a.dataset.href = mm[2];
      renderInline(a, mm[1], state);
      parent.append(a);
    }
    rest = rest.slice(m.index + tok.length);
  }
}

class TableWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly table: ParsedTable,
  ) {
    super();
  }
  eq(o: TableWidget) {
    return o.text === this.text;
  }
  get estimatedHeight() {
    return 30 * (this.table.rows.length + 1) + 8;
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "cm-table-widget";
    wrap.title = "Click to edit the table";
    const table = document.createElement("table");
    // Right-to-left when the cells hold more Hebrew (or Arabic) letters than Latin ones ("d10 | מפגש" is a Hebrew table).
    const rtl = (this.text.match(/[\u0590-\u08ff]/g) ?? []).length;
    const ltr = (this.text.replace(/\[\[[^\]]*\]\]/g, "").match(/[A-Za-z]/g) ?? []).length;
    table.dir = rtl > ltr ? "rtl" : "ltr";
    wrap.dir = table.dir; // so a Hebrew table sits on the right
    const row = (cells: string[], tag: "th" | "td") => {
      const tr = document.createElement("tr");
      cells.forEach((c, i) => {
        const cell = document.createElement(tag);
        cell.dir = "auto";
        const align = this.table.align[i];
        if (align) cell.style.textAlign = align;
        // Short cells (dice, numbers, labels like "01–25") never wrap.
        if (c.length <= 12) cell.className = "cm-table-short";
        renderInline(cell, c, view.state);
        tr.append(cell);
      });
      return tr;
    };
    const thead = document.createElement("thead");
    thead.append(row(this.table.header, "th"));
    const tbody = document.createElement("tbody");
    for (const r of this.table.rows) tbody.append(row(r, "td"));
    table.append(thead, tbody);
    wrap.append(table);
    wrap.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const ctx = getContext(view.state);
      const link = (e.target as HTMLElement).closest<HTMLElement>("[data-target],[data-href]");
      if (link?.dataset.target !== undefined) {
        ctx.openWikiLink(link.dataset.target, link.dataset.heading || null, { newTab: e.metaKey || e.ctrlKey });
        return;
      }
      if (link?.dataset.href !== undefined) {
        ctx.openUrl(link.dataset.href);
        return;
      }
      // Put the cursor on the clicked row's line.
      const pos = view.posAtDOM(wrap);
      const tr = (e.target as HTMLElement).closest("tr");
      const rowIndex = tr ? [...table.querySelectorAll("tr")].indexOf(tr) : 0;
      const line = view.state.doc.lineAt(pos).number + (rowIndex > 0 ? rowIndex + 1 : 0);
      const target = view.state.doc.line(Math.min(line, view.state.doc.lines));
      // Inside the row's last cell (before a closing pipe), so typing edits the table.
      const end = target.text.replace(/\s*\|?\s*$/, "").length;
      view.focus();
      view.dispatch({ selection: { anchor: target.from + end } });
    });
    return wrap;
  }
  ignoreEvent() {
    return true;
  }
}

// ---- state ----------------------------------------------------------------------------

const setFocus = StateEffect.define<boolean>();

const focusField = StateField.define<boolean>({
  create: () => false,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setFocus)) return e.value;
    return v;
  },
});

function buildTables(state: EditorState): DecorationSet {
  const focused = state.field(focusField);
  const decos: Range<Decoration>[] = [];
  const doc = state.doc;
  syntaxTree(state).iterate({
    enter: (ref) => {
      if (ref.name !== "Table") return;
      const from = doc.lineAt(ref.from).from;
      const to = doc.lineAt(ref.to).to;
      // The cursor right before or after the table (the line ends next to it) counts as inside, so arrow keys can reach it.
      const touched = focused && state.selection.ranges.some((r) => r.from <= to + 1 && r.to >= from - 1);
      if (touched) return false;
      const text = doc.sliceString(from, to);
      const table = parseTable(text);
      if (table) decos.push(Decoration.replace({ widget: new TableWidget(text, table), block: true }).range(from, to));
      return false;
    },
  });
  return Decoration.set(decos, true);
}

const tablesField = StateField.define<DecorationSet>({
  create: (state) => buildTables(state),
  update(value, tr) {
    if (tr.docChanged || tr.selection || tr.effects.some((e) => e.is(setFocus)) || syntaxTree(tr.startState) !== syntaxTree(tr.state))
      return buildTables(tr.state);
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const tablePreview: Extension = [
  focusField,
  tablesField,
  EditorView.focusChangeEffect.of((_state, focusing) => setFocus.of(focusing)),
];
