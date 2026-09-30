import { useEffect, useMemo, useRef, useState } from "react";
import { useDoc } from "../store/doc";
import { useUi } from "../store/ui";
import { confirmAsync } from "../components/ui";
import {
  ATTACHMENTS_FOLDER,
  LEVELS_FOLDER,
  checkName,
  createFolder,
  createNote,
  dirOf,
  docKey,
  nameOf,
  openDoc,
  trashPath,
  useNotes,
  type DocRef,
} from "./store";
import { levelDocNames, moveWithLinks } from "./links";
import { SRD_CONDITION_LIST, SRD_FOLDER, SRD_MONSTER_LIST } from "../rules/srd";

interface FolderNode {
  path: string;
  name: string;
  folders: FolderNode[];
  notes: string[];
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function buildTree(folders: string[], files: string[]): FolderNode {
  const root: FolderNode = { path: "", name: "", folders: [], notes: [] };
  const byPath = new Map<string, FolderNode>([["", root]]);
  const ensure = (path: string): FolderNode => {
    const hit = byPath.get(path);
    if (hit) return hit;
    const node: FolderNode = { path, name: path.slice(path.lastIndexOf("/") + 1), folders: [], notes: [] };
    byPath.set(path, node);
    ensure(dirOf(path)).folders.push(node);
    return node;
  };
  for (const f of folders) if (f !== ATTACHMENTS_FOLDER && !f.startsWith(ATTACHMENTS_FOLDER + "/")) ensure(f);
  for (const f of files) ensure(dirOf(f)).notes.push(f);
  const sort = (n: FolderNode) => {
    n.folders.sort((a, b) => collator.compare(a.name, b.name));
    n.notes.sort((a, b) => collator.compare(nameOf(a), nameOf(b)));
    n.folders.forEach(sort);
  };
  sort(root);
  return root;
}

type MenuTarget = { kind: "folder"; path: string } | { kind: "note"; path: string } | { kind: "level"; levelId: string } | { kind: "levels" };

interface MenuState {
  x: number;
  y: number;
  target: MenuTarget;
}

function toggleExpanded(path: string) {
  const s = useNotes.getState();
  const expanded = s.expanded.includes(path) ? s.expanded.filter((p) => p !== path) : [...s.expanded, path];
  s.set({ expanded });
}

async function deleteItem(target: MenuTarget) {
  if (target.kind !== "folder" && target.kind !== "note") return;
  const what = target.kind === "folder" ? `the folder “${nameOf(target.path)}” and everything in it` : `“${nameOf(target.path)}”`;
  const ok = await confirmAsync(
    <>
      Move {what} to the trash? (It is kept in <code>notes/.trash</code>.)
    </>,
    { confirmLabel: "Move to trash", danger: true },
  );
  if (!ok) return;
  try {
    await trashPath(target.path);
  } catch (e) {
    useUi.getState().showToast(String(e));
  }
}

export function FileTree() {
  const files = useNotes((s) => s.files);
  const folders = useNotes((s) => s.folders);
  const expanded = useNotes((s) => s.expanded);
  const tabs = useNotes((s) => s.tabs);
  const activeTab = useNotes((s) => s.activeTab);
  const dungeon = useDoc((s) => s.dungeon);
  const tree = useMemo(() => buildTree(folders, Object.keys(files)), [folders, files]);
  const levelNames = useMemo(() => levelDocNames(dungeon), [dungeon]);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const active = tabs.find((t) => t.id === activeTab)?.doc;
  const activeKey = active ? docKey(active) : null;

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  const newNote = async (folder: string) => {
    try {
      const path = await createNote(folder);
      openDoc({ kind: "note", path });
      setRenaming(path);
    } catch (e) {
      useUi.getState().showToast(String(e));
    }
  };
  const newFolder = async (parent: string) => {
    try {
      const path = await createFolder(parent);
      setRenaming(path);
    } catch (e) {
      useUi.getState().showToast(String(e));
    }
  };

  const drop = async (e: React.DragEvent, folder: string) => {
    e.preventDefault();
    setDragOver(null);
    const from = e.dataTransfer.getData("text/x-note-path");
    if (!from) return;
    const name = from.slice(from.lastIndexOf("/") + 1);
    const to = folder ? `${folder}/${name}` : name;
    if (to === from || folder === from || folder.startsWith(from + "/")) return;
    const isFolder = !from.endsWith(".md");
    const err = checkName(folder, isFolder ? name : name.replace(/\.md$/i, ""), isFolder);
    if (err) return useUi.getState().showToast(err);
    try {
      await moveWithLinks(from, to);
      if (folder && !useNotes.getState().expanded.includes(folder)) toggleExpanded(folder);
    } catch (err2) {
      useUi.getState().showToast(String(err2));
    }
  };

  const dropProps = (folder: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes("text/x-note-path")) return;
      e.preventDefault();
      e.stopPropagation();
      setDragOver(folder);
    },
    onDragLeave: () => setDragOver((d) => (d === folder ? null : d)),
    onDrop: (e: React.DragEvent) => {
      e.stopPropagation();
      void drop(e, folder);
    },
  });

  const open = (doc: DocRef, e: React.MouseEvent) => openDoc(doc, { newTab: e.metaKey || e.ctrlKey });

  const renderFolder = (node: FolderNode, depth: number): React.ReactNode => (
    <div key={node.path}>
      {node.path && (
        <div
          className={`tree-row folder ${dragOver === node.path ? "drag-over" : ""}`}
          style={{ paddingInlineStart: 8 + depth * 14 }}
          draggable={renaming !== node.path}
          onDragStart={(e) => e.dataTransfer.setData("text/x-note-path", node.path)}
          {...dropProps(node.path)}
          onClick={() => toggleExpanded(node.path)}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, target: { kind: "folder", path: node.path } });
          }}
        >
          <span className={`tree-caret ${expanded.includes(node.path) ? "open" : ""}`}>›</span>
          {renaming === node.path ? (
            <RenameInput path={node.path} isFolder onDone={() => setRenaming(null)} />
          ) : (
            <span className="tree-name" dir="auto">
              {node.name}
            </span>
          )}
        </div>
      )}
      {(!node.path || expanded.includes(node.path)) && (
        <>
          {node.folders.map((f) => renderFolder(f, node.path ? depth + 1 : depth))}
          {node.notes.map((p) => (
            <div
              key={p}
              className={`tree-row note ${activeKey === `note:${p}` ? "active" : ""}`}
              style={{ paddingInlineStart: 8 + (node.path ? depth + 1 : depth) * 14 + 14 }}
              draggable={renaming !== p}
              onDragStart={(e) => e.dataTransfer.setData("text/x-note-path", p)}
              onClick={(e) => renaming !== p && open({ kind: "note", path: p }, e)}
              onDoubleClick={() => setRenaming(p)}
              onKeyDown={(e) => e.key === "F2" && setRenaming(p)}
              tabIndex={0}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, target: { kind: "note", path: p } });
              }}
            >
              {renaming === p ? (
                <RenameInput path={p} isFolder={false} onDone={() => setRenaming(null)} />
              ) : (
                <span className="tree-name" dir="auto">
                  {nameOf(p)}
                </span>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );

  const levelsOpen = expanded.includes(`/${LEVELS_FOLDER}`);
  return (
    <div className="file-tree">
      <div className="tree-toolbar">
        <span className="tree-title">Notes</span>
        <button className="icon-btn" title="New note (⌘N)" onClick={() => void newNote(active?.kind === "note" ? dirOf(active.path) : "")}>
          ＋📝
        </button>
        <button className="icon-btn" title="New folder" onClick={() => void newFolder("")}>
          ＋📁
        </button>
      </div>
      <div
        className={`tree-body ${dragOver === "" ? "drag-over" : ""}`}
        {...dropProps("")}
        onContextMenu={(e) => {
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY, target: { kind: "folder", path: "" } });
        }}
      >
        <div
          className="tree-row folder locked"
          style={{ paddingInlineStart: 8 }}
          onClick={() => toggleExpanded(`/${LEVELS_FOLDER}`)}
          title="One document per level, generated from the map. You can edit the text of each section, not the structure."
        >
          <span className={`tree-caret ${levelsOpen ? "open" : ""}`}>›</span>
          <span className="tree-name">{LEVELS_FOLDER}</span>
          <span className="tree-lock">🔒</span>
        </div>
        {levelsOpen &&
          dungeon?.levels.map((l) => (
            <div
              key={l.id}
              className={`tree-row note level-doc-row ${activeKey === `level:${l.id}` ? "active" : ""}`}
              style={{ paddingInlineStart: 36 }}
              onClick={(e) => open({ kind: "level", levelId: l.id }, e)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, target: { kind: "level", levelId: l.id } });
              }}
            >
              <span className="tree-name" dir="auto">
                {levelNames.get(l.id)}
              </span>
            </div>
          ))}
        <SrdFolder activeKey={activeKey} open={open} />
        {renderFolder(tree, 0)}
        {Object.keys(files).length === 0 && folders.length === 0 && (
          <p className="hint tree-empty">No notes yet. Create one with ＋📝, or right-click here.</p>
        )}
      </div>
      {menu && (
        <div className="context-menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
          <ContextMenuItems
            target={menu.target}
            close={() => setMenu(null)}
            newNote={newNote}
            newFolder={newFolder}
            rename={(p) => setRenaming(p)}
          />
        </div>
      )}
    </div>
  );
}

/** The bundled 5e SRD: read-only monsters and conditions. */
function SrdFolder({ activeKey, open }: { activeKey: string | null; open: (doc: DocRef, e: React.MouseEvent) => void }) {
  const expanded = useNotes((s) => s.expanded);
  const key = (sub: string) => `/${SRD_FOLDER}${sub}`;
  const isOpen = (sub: string) => expanded.includes(key(sub));
  const folder = (sub: string, name: string, depth: number, count?: number) => (
    <div className="tree-row folder locked" style={{ paddingInlineStart: 8 + depth * 14 }} onClick={() => toggleExpanded(key(sub))}>
      <span className={`tree-caret ${isOpen(sub) ? "open" : ""}`}>›</span>
      <span className="tree-name">{name}</span>
      {count !== undefined && <span className="tree-count">{count}</span>}
      {depth === 0 && <span className="tree-lock">🔒</span>}
    </div>
  );
  const row = (id: string, name: string) => (
    <div
      key={id}
      className={`tree-row note srd-row ${activeKey === `srd:${id}` ? "active" : ""}`}
      style={{ paddingInlineStart: 50 }}
      onClick={(e) => open({ kind: "srd", id }, e)}
    >
      <span className="tree-name">{name}</span>
    </div>
  );
  return (
    <div title="The free 5e rules (SRD 5.1, 2014): monsters and conditions. Read-only — “Make a custom copy” to edit a monster.">
      {folder("", SRD_FOLDER, 0)}
      {isOpen("") && (
        <>
          {folder("/Conditions", "Conditions", 1, SRD_CONDITION_LIST.length)}
          {isOpen("/Conditions") && SRD_CONDITION_LIST.map((c) => row(`condition:${c.id}`, c.name))}
          {folder("/Monsters", "Monsters", 1, SRD_MONSTER_LIST.length)}
          {isOpen("/Monsters") && SRD_MONSTER_LIST.map((m) => row(`monster:${m.id}`, m.name))}
        </>
      )}
    </div>
  );
}

function ContextMenuItems({
  target,
  close,
  newNote,
  newFolder,
  rename,
}: {
  target: MenuTarget;
  close: () => void;
  newNote: (folder: string) => Promise<void>;
  newFolder: (parent: string) => Promise<void>;
  rename: (path: string) => void;
}) {
  const item = (label: string, run: () => void, danger = false) => (
    <button
      className={`menu-item ${danger ? "danger-text" : ""}`}
      onClick={() => {
        close();
        run();
      }}
    >
      {label}
    </button>
  );
  switch (target.kind) {
    case "folder":
      return (
        <>
          {item("New note", () => void newNote(target.path))}
          {item("New folder", () => void newFolder(target.path))}
          {target.path && item("Rename", () => rename(target.path))}
          {target.path && item("Delete…", () => void deleteItem(target), true)}
        </>
      );
    case "note":
      return (
        <>
          {item("Open in new tab", () => openDoc({ kind: "note", path: target.path }, { newTab: true }))}
          {item("Rename", () => rename(target.path))}
          {item("Delete…", () => void deleteItem(target), true)}
        </>
      );
    case "level":
      return (
        <>
          {item("Open", () => openDoc({ kind: "level", levelId: target.levelId }))}
          {item("Open in new tab", () => openDoc({ kind: "level", levelId: target.levelId }, { newTab: true }))}
          {item("Show on map", () => {
            useNotes.getState().set({ mainView: "dungeon" });
            useUi.getState().set({ currentLevelId: target.levelId, selection: null, draw: null });
          })}
        </>
      );
    default:
      return null;
  }
}

/** Inline rename of a note or folder; updates links everywhere. */
export function RenameInput({ path, isFolder, onDone, className }: { path: string; isFolder: boolean; onDone: () => void; className?: string }) {
  const [value, setValue] = useState(nameOf(path));
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const commit = async () => {
    if (done.current) return;
    const name = value.trim();
    if (name === nameOf(path)) {
      done.current = true;
      return onDone();
    }
    const folder = dirOf(path);
    const err = checkName(folder, name, isFolder, path);
    if (err) {
      setError(err);
      ref.current?.focus();
      return;
    }
    done.current = true;
    const to = (folder ? `${folder}/` : "") + (isFolder ? name : `${name}.md`);
    try {
      await moveWithLinks(path, to);
    } catch (e) {
      useUi.getState().showToast(String(e));
    }
    onDone();
  };
  return (
    <span className={`rename-wrap ${className ?? ""}`} onClick={(e) => e.stopPropagation()}>
      <input
        ref={ref}
        className="rename-input"
        dir="auto"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") void commit();
          if (e.key === "Escape") {
            done.current = true;
            onDone();
          }
        }}
      />
      {error && <span className="rename-error">{error}</span>}
    </span>
  );
}
