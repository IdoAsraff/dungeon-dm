/**
 * Obsidian-style live preview: markdown syntax is hidden and rendered
 * (headings, emphasis, links, images, quotes, lists, checkboxes, rules,
 * callouts, tags, [[wiki links]]) except where the cursor is, where the
 * raw markdown is shown for editing.
 */
import { syntaxTree } from "@codemirror/language";
import { StateEffect, type EditorState, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { getContext, headingOffset, type ResolvedImage } from "./context";
import { parseWikiLinks } from "../lib/wikiLinks";

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
/** Obsidian tags: #word, may contain / - _ and digits but not be purely numeric. */
const TAG_RE = /(^|[\s(])#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu;
const CALLOUT_RE = /^(\s*(?:>\s*)+)\[!([\w-]+)\]([+-]?)\s*/;

export const CALLOUT_TYPES: Record<string, string> = {
  note: "note", info: "note", todo: "note",
  tip: "tip", hint: "tip", important: "tip", success: "success", check: "success", done: "success",
  question: "question", help: "question", faq: "question",
  warning: "warning", caution: "warning", attention: "warning",
  failure: "danger", fail: "danger", missing: "danger", danger: "danger", error: "danger", bug: "danger",
  example: "example", quote: "quote", cite: "quote", abstract: "note", summary: "note", tldr: "note",
};

// ---- widgets -----------------------------------------------------------------

class ImageWidget extends WidgetType {
  constructor(
    readonly key: string,
    readonly img: ResolvedImage | null,
    readonly alt: string,
    readonly width: number | null,
  ) {
    super();
  }
  eq(o: ImageWidget) {
    return o.key === this.key && o.img?.url === this.img?.url && o.width === this.width;
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("span");
    wrap.className = "cm-image";
    if (!this.img) {
      wrap.classList.add("cm-image-missing");
      wrap.textContent = `🖼 ${this.alt || this.key} — not found`;
      return wrap;
    }
    const img = document.createElement("img");
    img.src = this.img.url;
    img.alt = this.alt;
    img.draggable = false;
    if (this.width) img.style.width = `${this.width}px`;
    wrap.appendChild(img);
    const ctx = getContext(view.state);
    const path = this.img.path;
    if (ctx.showHandout && path) {
      const btn = document.createElement("button");
      btn.className = "cm-image-handout";
      btn.textContent = "▶ Show to players";
      btn.title = "Show this image full-screen in the player window";
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        ctx.showHandout?.(path);
      });
      wrap.appendChild(btn);
    }
    return wrap;
  }
  ignoreEvent(e: Event) {
    // Let clicks on the image place the cursor there (revealing the source).
    return e.type !== "mousedown";
  }
}

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-bullet";
    s.textContent = "•";
    return s;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly pos: number) {
    super();
  }
  eq(o: CheckboxWidget) {
    return o.checked === this.checked && o.pos === this.pos;
  }
  toDOM(view: EditorView) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-task-box";
    box.checked = this.checked;
    box.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({ changes: { from: this.pos + 1, to: this.pos + 2, insert: this.checked ? " " : "x" } });
    });
    return box;
  }
  ignoreEvent() {
    return true;
  }
}

class RuleWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-rule";
    return s;
  }
}

// ---- decoration building -----------------------------------------------------------

const hide = Decoration.replace({});

function hasAncestor(node: SyntaxNode, names: string[]): boolean {
  for (let n: SyntaxNode | null = node.parent; n; n = n.parent) if (names.includes(n.name)) return true;
  return false;
}

function childrenNamed(node: SyntaxNode, name: string): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (let c = node.firstChild; c; c = c.nextSibling) if (c.name === name) out.push(c);
  return out;
}

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const doc = state.doc;
  const decos: Range<Decoration>[] = [];
  const focused = view.hasFocus;
  const ranges = state.selection.ranges;
  const touches = (from: number, to: number) => focused && ranges.some((r) => r.from <= to && r.to >= from);
  const lineTouched = (pos: number) => {
    const l = doc.lineAt(pos);
    return touches(l.from, l.to);
  };
  const ctx = getContext(state);
  const offset = state.facet(headingOffset);
  const quoteDepth = new Map<number, number>();
  const code: [number, number][] = [];
  const hideAfter = (from: number, to: number) => {
    // Hide a marker plus one following space.
    const next = doc.sliceString(to, to + 1);
    decos.push(hide.range(from, next === " " ? to + 1 : to));
  };

  for (const { from, to } of view.visibleRanges) {
    // [[wiki links]] look like (reference) links/images to the markdown
    // parser; those nodes are left to the wiki-link pass below.
    const wiki: [number, number][] = [];
    for (let pos = from; pos <= to; ) {
      const line = doc.lineAt(pos);
      for (const l of parseWikiLinks(line.text)) wiki.push([line.from + l.from, line.from + l.to]);
      pos = line.to + 1;
    }
    const inWiki = (a: number, b: number) => wiki.some(([x, y]) => a < y && b > x);
    syntaxTree(state).iterate({
      from,
      to,
      enter: (ref) => {
        const node = ref.node;
        const name = ref.name;
        const heading = /^ATXHeading(\d)$/.exec(name);
        if (heading) {
          const level = Math.min(6, Number(heading[1]) + offset(state, ref.from));
          decos.push(Decoration.line({ class: `cm-h cm-h${level}` }).range(doc.lineAt(ref.from).from));
          return;
        }
        switch (name) {
          case "SetextHeading1":
          case "SetextHeading2":
            decos.push(Decoration.line({ class: `cm-h cm-h${name.endsWith("1") ? 1 : 2}` }).range(doc.lineAt(ref.from).from));
            return false;
          case "HeaderMark":
            if (hasAncestor(node, ["ATXHeading1", "ATXHeading2", "ATXHeading3", "ATXHeading4", "ATXHeading5", "ATXHeading6"]) && !lineTouched(ref.from))
              hideAfter(ref.from, ref.to);
            return;
          case "Emphasis":
            decos.push(Decoration.mark({ class: "cm-em" }).range(ref.from, ref.to));
            return;
          case "StrongEmphasis":
            decos.push(Decoration.mark({ class: "cm-strong" }).range(ref.from, ref.to));
            return;
          case "Strikethrough":
            decos.push(Decoration.mark({ class: "cm-strike" }).range(ref.from, ref.to));
            return;
          case "InlineCode":
            code.push([ref.from, ref.to]);
            decos.push(Decoration.mark({ class: "cm-inline-code" }).range(ref.from, ref.to));
            return;
          case "EmphasisMark":
          case "StrikethroughMark":
          case "CodeMark": {
            const parent = node.parent;
            if (!parent || parent.name === "FencedCode") return;
            if (!touches(parent.from, parent.to)) decos.push(hide.range(ref.from, ref.to));
            return;
          }
          case "Link": {
            if (inWiki(ref.from, ref.to)) return false;
            const marks = childrenNamed(node, "LinkMark");
            const url = node.getChild("URL");
            if (marks.length < 2) return false;
            const open = marks[0];
            const close = marks[1];
            const href = url ? doc.sliceString(url.from, url.to) : "";
            if (!touches(ref.from, ref.to) && url) {
              decos.push(hide.range(open.from, open.to));
              decos.push(hide.range(close.from, ref.to));
              if (close.from > open.to)
                decos.push(Decoration.mark({ class: "cm-link", attributes: { "data-href": href } }).range(open.to, close.from));
            } else {
              decos.push(Decoration.mark({ class: "cm-link-src" }).range(ref.from, ref.to));
            }
            return false;
          }
          case "Image": {
            if (inWiki(ref.from, ref.to)) return false;
            const url = node.getChild("URL");
            const marks = childrenNamed(node, "LinkMark");
            const src = url ? doc.sliceString(url.from, url.to) : "";
            const alt = marks.length >= 2 ? doc.sliceString(marks[0].to, marks[1].from) : "";
            const widget = new ImageWidget(src, src ? ctx.resolveImage(src) : null, alt, null);
            if (!touches(ref.from, ref.to)) decos.push(Decoration.replace({ widget }).range(ref.from, ref.to));
            else decos.push(Decoration.widget({ widget, side: 1 }).range(ref.to));
            return false;
          }
          case "URL":
            if (!hasAncestor(node, ["Link", "Image"])) {
              const href = doc.sliceString(ref.from, ref.to);
              decos.push(Decoration.mark({ class: "cm-link", attributes: { "data-href": href } }).range(ref.from, ref.to));
            }
            return;
          case "QuoteMark": {
            const line = doc.lineAt(ref.from);
            quoteDepth.set(line.from, (quoteDepth.get(line.from) ?? 0) + 1);
            if (!lineTouched(ref.from)) hideAfter(ref.from, ref.to);
            return;
          }
          case "ListMark": {
            const item = node.parent;
            const list = item?.parent;
            const isTask = !!item?.getChild("Task");
            if (lineTouched(ref.from)) return;
            if (isTask) hideAfter(ref.from, ref.to);
            else if (list?.name === "BulletList")
              decos.push(Decoration.replace({ widget: new BulletWidget() }).range(ref.from, ref.to));
            return;
          }
          case "TaskMarker": {
            const text = doc.sliceString(ref.from, ref.to);
            const checked = /x/i.test(text);
            if (checked) {
              const line = doc.lineAt(ref.from);
              if (ref.to < line.to) decos.push(Decoration.mark({ class: "cm-task-done" }).range(ref.to, line.to));
            }
            if (!touches(ref.from, ref.to))
              decos.push(Decoration.replace({ widget: new CheckboxWidget(checked, ref.from) }).range(ref.from, ref.to));
            return;
          }
          case "HorizontalRule":
            if (!lineTouched(ref.from)) decos.push(Decoration.replace({ widget: new RuleWidget() }).range(ref.from, ref.to));
            return false;
          case "FencedCode": {
            code.push([ref.from, ref.to]);
            const first = doc.lineAt(ref.from).number;
            const last = doc.lineAt(ref.to).number;
            for (let n = first; n <= last; n++) {
              const cls = n === first ? "cm-codeblock cm-codeblock-first" : n === last ? "cm-codeblock cm-codeblock-last" : "cm-codeblock";
              decos.push(Decoration.line({ class: cls }).range(doc.line(n).from));
            }
            return false;
          }
          case "Table": {
            code.push([ref.from, ref.to]);
            const first = doc.lineAt(ref.from).number;
            const last = doc.lineAt(ref.to).number;
            for (let n = first; n <= last; n++) decos.push(Decoration.line({ class: "cm-table-line" }).range(doc.line(n).from));
            return false;
          }
          case "HTMLBlock":
          case "CommentBlock":
            code.push([ref.from, ref.to]);
            return false;
        }
      },
    });

    // Line-based passes: quotes/callouts, wiki links, tags.
    const inCode = (pos: number) => code.some(([a, b]) => pos >= a && pos < b);
    let callout: string | null = null;
    for (let pos = from; pos <= to; ) {
      const line = doc.lineAt(pos);
      const depth = quoteDepth.get(line.from) ?? 0;
      if (depth > 0) {
        const m = CALLOUT_RE.exec(line.text);
        let cls = `cm-quote cm-quote-${Math.min(depth, 3)}`;
        if (m) {
          callout = CALLOUT_TYPES[m[2].toLowerCase()] ?? "note";
          cls += ` cm-callout cm-callout-${callout} cm-callout-title`;
          if (!lineTouched(line.from)) {
            const start = line.from + m[1].length;
            decos.push(hide.range(start, line.from + m[0].length));
            if (line.from + m[0].length === line.to)
              decos.push(Decoration.widget({ widget: new CalloutTitleWidget(m[2]), side: 1 }).range(line.to));
          }
        } else if (callout) {
          cls += ` cm-callout cm-callout-${callout}`;
        }
        decos.push(Decoration.line({ class: cls }).range(line.from));
      } else {
        callout = null;
      }

      if (!inCode(line.from)) {
        for (const l of parseWikiLinks(line.text)) {
          const a = line.from + l.from;
          const b = line.from + l.to;
          if (inCode(a)) continue;
          const touched = touches(a, b);
          if (l.embed) {
            const width = l.alias && /^\d+$/.test(l.alias) ? Number(l.alias) : null;
            if (IMAGE_EXT.test(l.target) || ctx.resolveEmbed(l.target)) {
              const widget = new ImageWidget(l.target, ctx.resolveEmbed(l.target), l.alias && !width ? l.alias : l.target, width);
              if (!touched) decos.push(Decoration.replace({ widget }).range(a, b));
              else decos.push(Decoration.widget({ widget, side: 1 }).range(b));
              continue;
            }
          }
          const exists = ctx.linkExists(l.target);
          if (touched) {
            decos.push(Decoration.mark({ class: "cm-wikilink-src" }).range(a, b));
            continue;
          }
          const inner = line.text.slice(l.from + (l.embed ? 3 : 2), l.to - 2);
          const innerFrom = a + (l.embed ? 3 : 2);
          const innerTo = b - 2;
          const bar = inner.indexOf("|");
          const shownFrom = bar === -1 ? innerFrom : innerFrom + bar + 1;
          decos.push(hide.range(a, shownFrom));
          decos.push(hide.range(innerTo, b));
          if (shownFrom < innerTo)
            decos.push(
              Decoration.mark({
                class: exists ? "cm-wikilink" : "cm-wikilink cm-wikilink-missing",
                attributes: { "data-target": l.target, "data-heading": l.heading ?? "" },
              }).range(shownFrom, innerTo),
            );
        }
        for (const m of line.text.matchAll(TAG_RE)) {
          const a = line.from + m.index! + m[1].length;
          const b = a + 1 + m[2].length;
          if (inCode(a)) continue;
          decos.push(Decoration.mark({ class: "cm-tag", attributes: { "data-tag": m[2] } }).range(a, b));
        }
      }
      pos = line.to + 1;
    }
  }
  return Decoration.set(decos, true);
}

class CalloutTitleWidget extends WidgetType {
  constructor(readonly type: string) {
    super();
  }
  eq(o: CalloutTitleWidget) {
    return o.type === this.type;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-callout-default-title";
    s.textContent = this.type.charAt(0).toUpperCase() + this.type.slice(1).toLowerCase();
    return s;
  }
}

/** Dispatch to redraw decorations when link targets or images may have changed. */
export const refreshDecorations = StateEffect.define<null>();

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.viewportChanged ||
        u.selectionSet ||
        u.focusChanged ||
        syntaxTree(u.startState) !== syntaxTree(u.state) ||
        u.transactions.some((tr) => tr.effects.some((e) => e.is(refreshDecorations)))
      )
        this.decorations = build(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

/**
 * Every line gets dir="auto" so Hebrew lines run right-to-left and English
 * lines left-to-right (CodeMirror's perLineTextDirection only *reads* the
 * direction of each line; it does not set it).
 */
const autoDir = Decoration.line({ attributes: { dir: "auto" } });
export const lineDirection = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view);
    }
    build(view: EditorView) {
      const decos: Range<Decoration>[] = [];
      for (const { from, to } of view.visibleRanges) {
        for (let pos = from; pos <= to; ) {
          const line = view.state.doc.lineAt(pos);
          decos.push(autoDir.range(line.from));
          pos = line.to + 1;
        }
      }
      return Decoration.set(decos);
    }
  },
  { decorations: (v) => v.decorations },
);

/** Clicking rendered links, wiki links and tags follows them. */
export const linkClicks = EditorView.domEventHandlers({
  mousedown(e, view) {
    if (e.button !== 0) return false;
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-href],[data-target],[data-tag]");
    if (!el || !view.contentDOM.contains(el)) return false;
    const ctx = getContext(view.state);
    e.preventDefault();
    if (el.dataset.target !== undefined) {
      ctx.openWikiLink(el.dataset.target, el.dataset.heading || null, { newTab: e.metaKey || e.ctrlKey });
    } else if (el.dataset.href !== undefined) {
      ctx.openUrl(el.dataset.href);
    } else if (el.dataset.tag !== undefined) {
      ctx.openTag(el.dataset.tag);
    }
    return true;
  },
});

/** Used by level documents to style their fixed lines consistently. */
export function headingLineClass(level: number): string {
  return `cm-h cm-h${Math.min(6, Math.max(1, level))}`;
}

export type { EditorState };
