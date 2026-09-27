/**
 * Obsidian-style [[wiki links]]: parsing, resolving and rewriting.
 *
 *   [[Note]]  [[Note|shown text]]  [[Note#Heading]]  [[folder/Note#Heading|shown]]
 *   ![[image.png]]  ![[image.png|300]]  (embeds)
 */

export interface WikiLink {
  /** Offsets of the whole `[[...]]` (including a leading `!` for embeds). */
  from: number;
  to: number;
  embed: boolean;
  target: string;
  heading: string | null;
  alias: string | null;
}

const WIKI_RE = /(!?)\[\[([^[\]\n]+?)\]\]/g;

export function splitLinkInner(inner: string): Pick<WikiLink, "target" | "heading" | "alias"> {
  let rest = inner;
  let alias: string | null = null;
  const bar = rest.indexOf("|");
  if (bar !== -1) {
    alias = rest.slice(bar + 1).trim() || null;
    rest = rest.slice(0, bar);
  }
  let heading: string | null = null;
  const hash = rest.indexOf("#");
  if (hash !== -1) {
    heading = rest.slice(hash + 1).trim() || null;
    rest = rest.slice(0, hash);
  }
  return { target: rest.trim(), heading, alias };
}

export function parseWikiLinks(text: string): WikiLink[] {
  const out: WikiLink[] = [];
  for (const m of text.matchAll(WIKI_RE)) {
    const from = m.index!;
    out.push({ from, to: from + m[0].length, embed: m[1] === "!", ...splitLinkInner(m[2]) });
  }
  return out;
}

export function formatWikiLink(link: Pick<WikiLink, "embed" | "target" | "heading" | "alias">): string {
  let inner = link.target;
  if (link.heading) inner += `#${link.heading}`;
  if (link.alias) inner += `|${link.alias}`;
  return `${link.embed ? "!" : ""}[[${inner}]]`;
}

/** "NPCs/Belak.md" -> "Belak" */
export function baseName(path: string): string {
  const file = path.split("/").pop() ?? path;
  return file.replace(/\.md$/i, "");
}

function norm(s: string): string {
  return s.trim().replace(/^\/+/, "").replace(/\.md$/i, "").normalize("NFC").toLowerCase();
}

export interface LinkTarget {
  /** Stable id of the target (e.g. "note:NPCs/Belak.md" or "level:level-1"). */
  id: string;
  /** Path without extension used for matching, e.g. "NPCs/Belak" or "levels/Grove Level". */
  path: string;
}

/**
 * Resolves link targets the way Obsidian does: an exact path match wins,
 * otherwise a file-name match, preferring the shortest path.
 */
export class LinkIndex {
  private byPath = new Map<string, LinkTarget>();
  private byName = new Map<string, LinkTarget[]>();

  constructor(readonly targets: LinkTarget[]) {
    for (const t of targets) {
      this.byPath.set(norm(t.path), t);
      const name = norm(baseName(t.path));
      const list = this.byName.get(name) ?? [];
      list.push(t);
      this.byName.set(name, list);
    }
    for (const list of this.byName.values()) {
      list.sort((a, b) => a.path.split("/").length - b.path.split("/").length || a.path.localeCompare(b.path));
    }
  }

  resolve(target: string): LinkTarget | null {
    if (!target.trim()) return null;
    const n = norm(target);
    return this.byPath.get(n) ?? this.byName.get(n)?.[0] ?? null;
  }

  /** The shortest link text that resolves to `t` (file name if unambiguous, else full path). */
  linkTextFor(t: LinkTarget): string {
    const name = baseName(t.path);
    return this.resolve(name)?.id === t.id ? name : t.path;
  }
}

/**
 * Rewrites every link in `text` that resolves (in `oldIndex`) to `id` so that
 * it points at `newTarget` instead, keeping headings, aliases and embeds.
 * Returns the text unchanged (same string) if nothing matched.
 */
export function rewriteLinks(text: string, oldIndex: LinkIndex, id: string, newTarget: string): string {
  const links = parseWikiLinks(text);
  let out = "";
  let last = 0;
  let changed = false;
  for (const l of links) {
    if (oldIndex.resolve(l.target)?.id !== id) continue;
    out += text.slice(last, l.from) + formatWikiLink({ ...l, target: newTarget });
    last = l.to;
    changed = true;
  }
  return changed ? out + text.slice(last) : text;
}

/** Characters that cannot appear in note or folder names. */
export const INVALID_NAME_CHARS = /[\\/:*?"<>|#^[\]]/;

/** Returns an error message, or null if `name` is a valid note/folder name. */
export function validateName(name: string): string | null {
  const n = name.trim();
  if (!n) return "Name cannot be empty.";
  if (n.startsWith(".")) return "Name cannot start with a dot.";
  if (INVALID_NAME_CHARS.test(n)) return 'Name cannot contain \\ / : * ? " < > | # ^ [ ]';
  return null;
}

/** Turns an arbitrary title (e.g. a level name) into a safe file name. */
export function safeFileName(name: string): string {
  const s = name.replace(new RegExp(INVALID_NAME_CHARS.source, "g"), "-").replace(/^\.+/, "").trim();
  return s || "Untitled";
}
