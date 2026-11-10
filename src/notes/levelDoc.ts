/**
 * Level documents: a generated, read-mostly view of a level:
 *
 *   <Level name>
 *   Background        -> level description (editable)
 *   Rooms
 *     <label> · <title>
 *       Read-aloud    -> room read-aloud (editable)
 *       DM notes      -> room DM notes (editable)
 *
 * The structure lines are fixed; only the text of each section can be
 * edited, and edits are written straight back into the level/room data.
 */
import { EditorState, Facet, StateEffect, StateField, type Extension, type Transaction } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { roomTitle, type Level } from "../types";
import { headingOffset } from "../editor/context";
import { markdownHeadingLevel, outlineLevel } from "../editor/folding";
import { sortedRooms, type FieldRef } from "./sources";

export interface LevelDocField {
  key: string;
  ref: FieldRef;
  from: number;
  to: number;
  /** Display depth added to markdown headings inside this section. */
  offset: number;
  placeholder: string;
}

export interface LockedLine {
  from: number;
  level: number;
  kind: "title" | "section" | "room" | "sub";
  text: string;
  roomId?: string;
  known?: boolean;
}

export interface LevelDocLayout {
  text: string;
  fields: LevelDocField[];
  locked: LockedLine[];
  /** Changes when the structure (not the section texts) changes. */
  signature: string;
}

export function roomHeading(label: string, title: string): string {
  return `${label} · ${title}`;
}

export function composeLevelDoc(level: Level, name: string): LevelDocLayout {
  let text = "";
  const fields: LevelDocField[] = [];
  const locked: LockedLine[] = [];
  const line = (s: string, lvl: number, kind: LockedLine["kind"], extra: Partial<LockedLine> = {}) => {
    locked.push({ from: text.length, level: lvl, kind, text: s, ...extra });
    text += s + "\n\n";
  };
  const field = (key: string, ref: FieldRef, value: string, offset: number, placeholder: string) => {
    const from = text.length;
    text += value;
    fields.push({ key, ref, from, to: text.length, offset, placeholder });
    text += "\n\n";
  };
  line(name, 1, "title");
  line("Background", 2, "section");
  field("desc", { kind: "level-desc", levelId: level.id }, level.description, 2, "Level background…");
  line("Rooms", 2, "section");
  const rooms = sortedRooms(level);
  for (const r of rooms) {
    line(roomHeading(r.label, roomTitle(r)), 3, "room", { roomId: r.id, known: r.playerKnown });
    line("Read-aloud", 4, "sub");
    field(`read:${r.id}`, { kind: "room-read", levelId: level.id, roomId: r.id }, r.readAloud, 4, "What you read to the players…");
    line("DM notes", 4, "sub");
    field(`dm:${r.id}`, { kind: "room-dm", levelId: level.id, roomId: r.id }, r.dmNotes, 4, "Monsters, traps, treasure, secrets…");
  }
  const signature = JSON.stringify([name, rooms.map((r) => [r.id, r.label, roomTitle(r), r.playerKnown])]);
  return { text, fields, locked, signature };
}

/** Current text of every field in `state`. */
export function fieldTexts(state: EditorState): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of state.field(layoutField).fields) out.set(f.key, state.sliceDoc(f.from, f.to));
  return out;
}

// ---- editor extension ----------------------------------------------------------------

export const setLayout = StateEffect.define<LevelDocLayout>();

/** Field and fixed-line positions, kept up to date as the text is edited. */
export const layoutField = StateField.define<{ fields: LevelDocField[]; locked: LockedLine[]; signature: string }>({
  create: () => ({ fields: [], locked: [], signature: "" }),
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setLayout)) return { fields: e.value.fields, locked: e.value.locked, signature: e.value.signature };
    if (!tr.docChanged) return value;
    return {
      signature: value.signature,
      fields: value.fields.map((f) => ({ ...f, from: tr.changes.mapPos(f.from, -1), to: tr.changes.mapPos(f.to, 1) })),
      locked: value.locked.map((l) => ({ ...l, from: tr.changes.mapPos(l.from, 1) })),
    };
  },
});

/** Syncing transactions from the level data are allowed to touch anything. */
export const levelDocSync = StateEffect.define<null>();

export function fieldAt(state: EditorState, pos: number): LevelDocField | null {
  return state.field(layoutField).fields.find((f) => pos >= f.from && pos <= f.to) ?? null;
}

/** Blocks any edit that is not fully inside one editable section. */
const protectStructure = EditorState.transactionFilter.of((tr: Transaction) => {
  if (!tr.docChanged || tr.effects.some((e) => e.is(levelDocSync) || e.is(setLayout))) return tr;
  const { fields } = tr.startState.field(layoutField);
  let ok = true;
  tr.changes.iterChangedRanges((fromA, toA) => {
    if (!fields.some((f) => fromA >= f.from && toA <= f.to)) ok = false;
  });
  if (!ok) {
    const cb = tr.startState.facet(onBlockedEdit);
    queueMicrotask(cb);
    return [];
  }
  return tr;
});

/** Called when an edit to the fixed structure is rejected. */
export const onBlockedEdit = Facet.define<() => void, () => void>({
  combine: (v) => v[v.length - 1] ?? (() => {}),
});

/** Called when "show on map" is clicked on a room heading. */
export const onShowRoom = Facet.define<(roomId: string) => void, (roomId: string) => void>({
  combine: (v) => v[v.length - 1] ?? (() => {}),
});

class RoomActions extends WidgetType {
  constructor(readonly roomId: string, readonly known: boolean) {
    super();
  }
  eq(o: RoomActions) {
    return o.roomId === this.roomId && o.known === this.known;
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("span");
    wrap.className = "cm-room-actions";
    if (this.known) {
      const k = document.createElement("span");
      k.className = "cm-room-known";
      k.title = "Known to players";
      k.textContent = "👁";
      wrap.appendChild(k);
    }
    const b = document.createElement("button");
    b.className = "cm-room-map";
    b.textContent = "📍 Map";
    b.title = "Show this room on the map";
    b.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      view.state.facet(onShowRoom)(this.roomId);
    });
    wrap.appendChild(b);
    return wrap;
  }
  ignoreEvent() {
    return true;
  }
}

class EmptyField extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(o: EmptyField) {
    return o.text === this.text;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-empty-field";
    s.textContent = this.text;
    return s;
  }
}

function structureDecorations(state: EditorState): DecorationSet {
  const { fields, locked } = state.field(layoutField);
  const decos = [];
  for (const l of locked) {
    const cls = `cm-h cm-h${l.level} cm-locked cm-locked-${l.kind}`;
    decos.push(Decoration.line({ class: cls }).range(l.from));
    if (l.kind === "room" && l.roomId) {
      const end = state.doc.lineAt(l.from).to;
      decos.push(Decoration.widget({ widget: new RoomActions(l.roomId, !!l.known), side: 1 }).range(end));
    }
  }
  const head = state.selection.main.head;
  for (const f of fields) {
    if (f.from === f.to && head !== f.from) decos.push(Decoration.widget({ widget: new EmptyField(f.placeholder), side: 1 }).range(f.from));
  }
  return Decoration.set(decos, true);
}

const structureDeco = StateField.define<DecorationSet>({
  create: (s) => structureDecorations(s),
  update: (d, tr) => (tr.docChanged || tr.selection || tr.effects.some((e) => e.is(setLayout)) ? structureDecorations(tr.state) : d),
  provide: (f) => EditorView.decorations.from(f),
});

export function levelDocExtensions(opts: { onShowRoom: (roomId: string) => void; onBlockedEdit: () => void }): Extension[] {
  return [
    layoutField,
    protectStructure,
    structureDeco,
    onShowRoom.of(opts.onShowRoom),
    onBlockedEdit.of(opts.onBlockedEdit),
    headingOffset.of((state, pos) => fieldAt(state, pos)?.offset ?? 0),
    outlineLevel.of((state, line) => {
      const l = state.field(layoutField).locked.find((x) => x.from === line.from);
      if (l) return l.level;
      return fieldAt(state, line.from) ? markdownHeadingLevel(state, line) : null;
    }),
  ];
}
