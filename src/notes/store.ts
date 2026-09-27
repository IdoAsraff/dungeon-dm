/**
 * The Notes tab: an Obsidian-like folder of markdown notes under
 * `<dungeon>/notes`, plus virtual per-level documents under `levels/`.
 */
import { create } from "zustand";
import { backend } from "../lib/backend";
import { validateName } from "../lib/wikiLinks";

/** What a tab (or the peek panel) shows. */
export type DocRef = { kind: "note"; path: string } | { kind: "level"; levelId: string };

export interface Tab {
  id: string;
  doc: DocRef;
  back: DocRef[];
  forward: DocRef[];
}

/** Where to scroll after opening a document. */
export interface Reveal {
  nonce: number;
  heading?: string | null;
  /** Select this text range (search results). */
  range?: { from: number; to: number };
  /** For level docs: scroll to a field (room / background). */
  field?: string;
}

export const LEVELS_FOLDER = "levels";
export const ATTACHMENTS_FOLDER = "attachments";

export function docKey(d: DocRef): string {
  return d.kind === "note" ? `note:${d.path}` : `level:${d.levelId}`;
}

let tabSeq = 0;
const newTabId = () => `t${Date.now().toString(36)}${(tabSeq++).toString(36)}`;

interface NotesState {
  dir: string | null;
  files: Record<string, string>;
  folders: string[];
  attachments: string[];

  mainView: "dungeon" | "notes";
  sidebar: "files" | "search";
  tabs: Tab[];
  activeTab: string | null;
  expanded: string[];
  /** Folded heading texts per document key. */
  folds: Record<string, string[]>;
  reveal: Record<string, Reveal>;
  /** Document shown in the slide-over panel on the dungeon tab. */
  peek: DocRef | null;
  searchQuery: string;
  /** Bumped to re-focus the search box. */
  searchFocus: number;
  quickSwitcher: boolean;
  /** Bumped whenever links may resolve differently (for editor redraws). */
  indexVersion: number;

  set: (patch: Partial<NotesState>) => void;
}

export const useNotes = create<NotesState>()((set) => ({
  dir: null,
  files: {},
  folders: [],
  attachments: [],
  mainView: "dungeon",
  sidebar: "files",
  tabs: [],
  activeTab: null,
  expanded: [],
  folds: {},
  reveal: {},
  peek: null,
  searchQuery: "",
  searchFocus: 0,
  quickSwitcher: false,
  indexVersion: 0,
  set: (patch) => set(patch),
}));

const get = () => useNotes.getState();
const patch = (p: Partial<NotesState>) => useNotes.getState().set(p);

// ---- persistence of note contents ---------------------------------------------------

const SAVE_MS = 400;
const pending = new Map<string, ReturnType<typeof setTimeout>>();
let saving: Promise<void> = Promise.resolve();

function writeNote(path: string) {
  const { dir, files } = get();
  if (!dir || files[path] === undefined) return;
  const content = files[path];
  saving = saving.then(() => backend.saveFiles(dir, { [`notes/${path}`]: content }, []).catch((e) => console.error("note save failed", e)));
}

export function setNoteContent(path: string, content: string) {
  const files = get().files;
  if (files[path] === content) return;
  patch({ files: { ...files, [path]: content } });
  clearTimeout(pending.get(path));
  pending.set(
    path,
    setTimeout(() => {
      pending.delete(path);
      writeNote(path);
    }, SAVE_MS),
  );
}

export async function flushNotes() {
  for (const [path, t] of pending) {
    clearTimeout(t);
    writeNote(path);
  }
  pending.clear();
  await saving;
  await saveWorkspace(true);
}

// ---- workspace (open tabs, folds...) ---------------------------------------------------

const WORKSPACE = ".dungeon-dm/workspace.json";
let workspaceTimer: ReturnType<typeof setTimeout> | null = null;
let lastWorkspace = "";

function workspaceJson(): string {
  const s = get();
  return JSON.stringify(
    {
      mainView: s.mainView,
      tabs: s.tabs.map((t) => ({ doc: t.doc })),
      activeTab: s.tabs.findIndex((t) => t.id === s.activeTab),
      expanded: s.expanded,
      folds: s.folds,
    },
    null,
    2,
  );
}

async function saveWorkspace(now = false) {
  if (workspaceTimer) clearTimeout(workspaceTimer);
  const run = async () => {
    const dir = get().dir;
    if (!dir) return;
    const json = workspaceJson();
    if (json === lastWorkspace) return;
    lastWorkspace = json;
    await backend.saveFiles(dir, { [WORKSPACE]: json + "\n" }, []).catch((e) => console.error("workspace save failed", e));
  };
  if (now) await run();
  else workspaceTimer = setTimeout(() => void run(), 800);
}

useNotes.subscribe((s, p) => {
  if (s.tabs !== p.tabs || s.activeTab !== p.activeTab || s.expanded !== p.expanded || s.folds !== p.folds || s.mainView !== p.mainView)
    void saveWorkspace();
});

// ---- loading -----------------------------------------------------------------

export async function loadNotes(dir: string) {
  const [listing, ws] = await Promise.all([backend.loadNotes(dir), backend.readText(dir, WORKSPACE).catch(() => null)]);
  let tabs: Tab[] = [];
  let activeTab: string | null = null;
  let expanded: string[] = [];
  let folds: Record<string, string[]> = {};
  let mainView: "dungeon" | "notes" = "dungeon";
  if (ws) {
    try {
      const w = JSON.parse(ws);
      tabs = (w.tabs ?? []).map((t: { doc: DocRef }) => ({ id: newTabId(), doc: t.doc, back: [], forward: [] }));
      activeTab = tabs[w.activeTab]?.id ?? tabs[0]?.id ?? null;
      expanded = Array.isArray(w.expanded) ? w.expanded : [];
      folds = w.folds && typeof w.folds === "object" ? w.folds : {};
      mainView = w.mainView === "notes" ? "notes" : "dungeon";
    } catch {
      /* ignore a corrupt workspace file */
    }
  }
  lastWorkspace = "";
  patch({
    dir,
    files: listing.files,
    folders: listing.folders,
    attachments: listing.attachments,
    tabs,
    activeTab,
    expanded,
    folds,
    mainView,
    reveal: {},
    peek: null,
    searchQuery: "",
    indexVersion: get().indexVersion + 1,
  });
  lastWorkspace = workspaceJson();
}

export function resetNotes() {
  for (const t of pending.values()) clearTimeout(t);
  pending.clear();
  patch({ dir: null, files: {}, folders: [], attachments: [], tabs: [], activeTab: null, peek: null, reveal: {}, mainView: "dungeon" });
}

// ---- tabs & navigation -----------------------------------------------------------------

export function openDoc(doc: DocRef, opts: { newTab?: boolean; reveal?: Omit<Reveal, "nonce"> } = {}) {
  const s = get();
  const key = docKey(doc);
  let tabs = s.tabs;
  let activeTab = s.activeTab;
  const current = tabs.find((t) => t.id === activeTab);
  const existing = tabs.find((t) => docKey(t.doc) === key);
  if (existing && (opts.newTab || !current || docKey(current.doc) !== key)) {
    activeTab = existing.id;
  } else if (opts.newTab || !current) {
    const tab: Tab = { id: newTabId(), doc, back: [], forward: [] };
    const idx = current ? tabs.indexOf(current) + 1 : tabs.length;
    tabs = [...tabs.slice(0, idx), tab, ...tabs.slice(idx)];
    activeTab = tab.id;
  } else if (docKey(current.doc) !== key) {
    const tab = { ...current, doc, back: [...current.back, current.doc], forward: [] };
    tabs = tabs.map((t) => (t.id === current.id ? tab : t));
  }
  const reveal = opts.reveal ? { ...s.reveal, [key]: { ...opts.reveal, nonce: Date.now() + Math.random() } } : s.reveal;
  patch({ tabs, activeTab, reveal, mainView: "notes" });
}

export function closeTab(id: string) {
  const s = get();
  const idx = s.tabs.findIndex((t) => t.id === id);
  if (idx === -1) return;
  const tabs = s.tabs.filter((t) => t.id !== id);
  const activeTab = s.activeTab === id ? (tabs[Math.min(idx, tabs.length - 1)]?.id ?? null) : s.activeTab;
  patch({ tabs, activeTab });
}

export function navigateHistory(direction: "back" | "forward") {
  const s = get();
  const tab = s.tabs.find((t) => t.id === s.activeTab);
  if (!tab) return;
  if (direction === "back" && tab.back.length) {
    const doc = tab.back[tab.back.length - 1];
    const next = { ...tab, doc, back: tab.back.slice(0, -1), forward: [tab.doc, ...tab.forward] };
    patch({ tabs: s.tabs.map((t) => (t.id === tab.id ? next : t)) });
  } else if (direction === "forward" && tab.forward.length) {
    const doc = tab.forward[0];
    const next = { ...tab, doc, back: [...tab.back, tab.doc], forward: tab.forward.slice(1) };
    patch({ tabs: s.tabs.map((t) => (t.id === tab.id ? next : t)) });
  }
}

export function setFolds(doc: DocRef, headings: string[]) {
  const key = docKey(doc);
  const prev = get().folds[key] ?? [];
  if (prev.length === headings.length && prev.every((h, i) => h === headings[i])) return;
  const folds = { ...get().folds };
  if (headings.length) folds[key] = headings;
  else delete folds[key];
  patch({ folds });
}

// ---- file operations -----------------------------------------------------------------

export const dirOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
export const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
const join = (folder: string, name: string) => (folder ? `${folder}/${name}` : name);

/** Validates a name for a new/renamed item in `folder`; returns an error or null. */
export function checkName(folder: string, name: string, isFolder: boolean, except?: string): string | null {
  const err = validateName(name);
  if (err) return err;
  if (!folder && [LEVELS_FOLDER, ".trash"].includes(name.trim().toLowerCase())) return `“${name}” is reserved.`;
  const s = get();
  const target = join(folder, isFolder ? name.trim() : `${name.trim()}.md`).toLowerCase();
  const taken = [...Object.keys(s.files), ...s.folders, ...s.attachments].some((p) => p.toLowerCase() === target && p !== except);
  return taken ? `“${name}” already exists here.` : null;
}

function uniqueName(folder: string, base: string, isFolder: boolean): string {
  for (let n = 0; ; n++) {
    const name = n === 0 ? base : `${base} ${n}`;
    if (!checkName(folder, name, isFolder)) return name;
  }
}

function ensureExpanded(folder: string) {
  if (!folder) return;
  const parts = folder.split("/");
  const all = parts.map((_, i) => parts.slice(0, i + 1).join("/"));
  const expanded = Array.from(new Set([...get().expanded, ...all]));
  patch({ expanded });
}

export async function createNote(folder: string, name?: string, content = ""): Promise<string> {
  const s = get();
  if (!s.dir) throw new Error("No dungeon open");
  const finalName = name ? name.trim() : uniqueName(folder, "Untitled", false);
  const err = checkName(folder, finalName, false);
  if (err) throw new Error(err);
  const path = join(folder, `${finalName}.md`);
  await backend.saveFiles(s.dir, { [`notes/${path}`]: content }, []);
  patch({ files: { ...get().files, [path]: content }, indexVersion: get().indexVersion + 1 });
  ensureExpanded(folder);
  return path;
}

export async function createFolder(parent: string, name?: string): Promise<string> {
  const s = get();
  if (!s.dir) throw new Error("No dungeon open");
  const finalName = name ? name.trim() : uniqueName(parent, "New folder", true);
  const err = checkName(parent, finalName, true);
  if (err) throw new Error(err);
  const path = join(parent, finalName);
  await backend.notesCreateFolder(s.dir, path);
  patch({ folders: [...get().folders, path].sort() });
  ensureExpanded(parent);
  return path;
}

function remapPath(p: string, from: string, to: string): string | null {
  if (p === from) return to;
  if (p.startsWith(from + "/")) return to + p.slice(from.length);
  return null;
}

function remapDoc(d: DocRef, from: string, to: string): DocRef {
  if (d.kind !== "note") return d;
  const np = remapPath(d.path, from, to);
  return np ? { kind: "note", path: np } : d;
}

/**
 * Moves/renames a note or folder on disk and in memory. Links are updated by
 * the caller (see links.ts) because they span notes and dungeon texts.
 */
export async function movePath(from: string, to: string) {
  const s = get();
  if (!s.dir) return;
  // Save pending edits first so they are not written to the old path.
  for (const [p, t] of pending) {
    if (remapPath(p, from, to)) {
      clearTimeout(t);
      pending.delete(p);
      writeNote(p);
    }
  }
  await saving;
  await backend.notesMove(s.dir, from, to);
  const cur = get();
  const files: Record<string, string> = {};
  for (const [p, c] of Object.entries(cur.files)) files[remapPath(p, from, to) ?? p] = c;
  const folders = cur.folders.map((f) => remapPath(f, from, to) ?? f).sort();
  const attachments = cur.attachments.map((f) => remapPath(f, from, to) ?? f);
  const expanded = cur.expanded.map((f) => remapPath(f, from, to) ?? f);
  const tabs = cur.tabs.map((t) => ({
    ...t,
    doc: remapDoc(t.doc, from, to),
    back: t.back.map((d) => remapDoc(d, from, to)),
    forward: t.forward.map((d) => remapDoc(d, from, to)),
  }));
  const folds: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(cur.folds)) {
    const np = k.startsWith("note:") ? remapPath(k.slice(5), from, to) : null;
    folds[np ? `note:${np}` : k] = v;
  }
  const peek = cur.peek ? remapDoc(cur.peek, from, to) : null;
  patch({ files, folders, attachments, expanded, tabs, folds, peek, indexVersion: cur.indexVersion + 1 });
}

/** Moves a note or folder to notes/.trash and closes affected tabs. */
export async function trashPath(path: string) {
  const s = get();
  if (!s.dir) return;
  const t = pending.get(path);
  if (t) {
    clearTimeout(t);
    pending.delete(path);
  }
  await backend.notesTrash(s.dir, path);
  const cur = get();
  const inside = (p: string) => p === path || p.startsWith(path + "/");
  const files = Object.fromEntries(Object.entries(cur.files).filter(([p]) => !inside(p)));
  const tabs = cur.tabs.filter((tab) => !(tab.doc.kind === "note" && inside(tab.doc.path)));
  const activeTab = tabs.some((tab) => tab.id === cur.activeTab) ? cur.activeTab : (tabs[tabs.length - 1]?.id ?? null);
  const peek = cur.peek?.kind === "note" && inside(cur.peek.path) ? null : cur.peek;
  patch({
    files,
    folders: cur.folders.filter((f) => !inside(f)),
    attachments: cur.attachments.filter((f) => !inside(f)),
    tabs,
    activeTab,
    peek,
    indexVersion: cur.indexVersion + 1,
  });
}

/** Registers a newly stored attachment (path relative to notes/). */
export function addAttachment(path: string) {
  const s = get();
  if (s.attachments.includes(path)) return;
  const folders = s.folders.includes(ATTACHMENTS_FOLDER) || !path.startsWith(ATTACHMENTS_FOLDER + "/") ? s.folders : [...s.folders, ATTACHMENTS_FOLDER].sort();
  patch({ attachments: [...s.attachments, path].sort(), folders, indexVersion: s.indexVersion + 1 });
}
