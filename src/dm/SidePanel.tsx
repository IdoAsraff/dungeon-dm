import { useEffect, useRef, useState } from "react";
import { roomTitle, type Door, type EntityRef, type GlobalObject, type Level, type Room } from "../types";
import { useDoc } from "../store/doc";
import { useSession } from "../store/session";
import { useUi } from "../store/ui";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { openDoc } from "../notes/store";
import { relinkRelabeledRoom } from "../notes/links";
import { useResizableWidth } from "../components/useResizableWidth";
import { ToolMenu } from "./Toolbar";
import { MAX_ROOM_LABEL, normalizeRoomLabel } from "../lib/roomLabels";
import { sortedRooms } from "../notes/sources";

function select(ref: EntityRef | null, zoom = false) {
  const ui = useUi.getState();
  ui.set({
    selection: ref,
    editingShape: false,
    draw: null,
    ...(zoom && ref ? { zoomRequest: { target: ref, nonce: Date.now() } } : {}),
  });
}

function ShapeButtons({ target }: { target: EntityRef }) {
  const editing = useUi((s) => s.editingShape);
  return (
    <>
      <button className={editing ? "active" : ""} onClick={() => useUi.getState().set({ editingShape: !editing, draw: null })}>
        {editing ? "✓ Done editing shape" : "✎ Edit shape"}
      </button>
      <ToolMenu
        label="Redraw"
        title="Replace the shape by drawing it again"
        onPick={(tool) => useUi.getState().set({ draw: { tool, purpose: { type: "reshape", target } }, editingShape: false })}
      />
    </>
  );
}

function RoomNumberEditor({ level, room }: { level: Level; room: Room }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(room.label);
  const [error, setError] = useState<string | null>(null);
  if (!editing) {
    return (
      <div className="room-number-row">
        <span className="room-number" dir="auto">{room.label}</span>
        <button
          className="icon-btn"
          title="Change the room's label (like 12 or 2-17C)"
          onClick={() => {
            setText(room.label);
            setError(null);
            setEditing(true);
          }}
        >
          ✎
        </button>
      </div>
    );
  }
  const commit = () => {
    if (normalizeRoomLabel(text) === room.label) {
      setEditing(false);
      return;
    }
    const oldLabel = room.label;
    const err = useDoc.getState().setRoomLabel(level.id, room.id, text);
    if (err) {
      setError(err);
      return;
    }
    relinkRelabeledRoom(level.id, room.id, oldLabel, normalizeRoomLabel(text));
    setEditing(false);
  };
  return (
    <div className="panel-title-edit">
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          commit();
        }}
      >
        <span>Room</span>
        <input
          autoFocus
          dir="auto"
          maxLength={MAX_ROOM_LABEL}
          placeholder="12 or 2-17C"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
        />
        <button type="submit" className="primary">
          Save
        </button>
        <button type="button" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </form>
      {error && <div className="error small">{error}</div>}
    </div>
  );
}

/** Room title; empty means "Room <label>". Grabs focus right after the room is drawn. */
function RoomTitleInput({ level, room }: { level: Level; room: Room }) {
  const ref = useRef<HTMLInputElement>(null);
  const focusTitleFor = useUi((s) => s.focusTitleFor);
  useEffect(() => {
    if (focusTitleFor !== room.id) return;
    ref.current?.focus();
    useUi.getState().set({ focusTitleFor: null });
  }, [focusTitleFor, room.id]);
  return (
    <input
      ref={ref}
      className="room-title-input"
      dir="auto"
      value={room.title}
      placeholder={`Room ${room.label}`}
      title="Room title (leave empty for “Room <label>”). Press Enter when done."
      onChange={(e) => useDoc.getState().updateRoom(level.id, room.id, { title: e.target.value }, `room-title-${room.id}`)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "Escape") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
    />
  );
}

function RoomPanel({ level, room }: { level: Level; room: Room }) {
  const focus = useSession((s) => s.focus);
  const doc = useDoc.getState();
  const session = useSession.getState();
  const isFocused = focus?.levelId === level.id && focus.roomId === room.id && room.playerKnown;
  const ref: EntityRef = { kind: "room", id: room.id };

  const reveal = () => doc.setRoomKnown(level.id, room.id, true);
  const focusPlayers = () => session.focusRoom({ levelId: level.id, roomId: room.id });

  return (
    <div className="panel">
      <RoomTitleInput level={level} room={room} />
      <RoomNumberEditor key={room.id} level={level} room={room} />
      <div className="badges">
        {room.playerKnown ? <span className="badge known">👁 Known to players</span> : <span className="badge hidden">Hidden from players</span>}
        {isFocused && <span className="badge focus">◎ Player window focused here</span>}
      </div>

      <div className="button-grid">
        {!room.playerKnown && (
          <>
            <button className="primary" onClick={reveal}>
              Reveal room
            </button>
            <button
              className="primary"
              onClick={() => {
                reveal();
                focusPlayers();
              }}
            >
              Reveal &amp; focus player window
            </button>
          </>
        )}
        {room.playerKnown && (
          <button
            disabled={isFocused}
            title={isFocused ? "The player window is focused on this room — focus another room first" : "Hide this room from the players"}
            onClick={() => doc.setRoomKnown(level.id, room.id, false)}
          >
            Conceal room
          </button>
        )}
        <button
          disabled={!room.playerKnown}
          title={room.playerKnown ? "Move the player window to this room" : "Reveal the room first"}
          onClick={focusPlayers}
        >
          ◎ Focus player window
        </button>
        <button
          onClick={() => openDoc({ kind: "level", levelId: level.id }, { reveal: { heading: room.label } })}
          title="Open this room in the level document (Notes)"
        >
          📝 Level doc
        </button>
        <ShapeButtons target={ref} />
        <button
          className="danger"
          onClick={() => {
            doc.deleteRoom(level.id, room.id);
            select(null);
            useUi.getState().showToast(`${roomTitle(room)} deleted — Ctrl/⌘+Z to undo`);
          }}
        >
          🗑 Delete room
        </button>
      </div>

      <h3>Read-aloud</h3>
      <MarkdownEditor
        key={`${room.id}-read`}
        value={room.readAloud}
        placeholder="What you read to the players when they enter…"
        className="read-aloud"
        onChange={(md) => doc.updateRoom(level.id, room.id, { readAloud: md }, `room-read-${room.id}`)}
      />
      <h3>DM notes</h3>
      <MarkdownEditor
        key={`${room.id}-dm`}
        value={room.dmNotes}
        placeholder="Monsters, traps, treasure, secrets…"
        onChange={(md) => doc.updateRoom(level.id, room.id, { dmNotes: md }, `room-dm-${room.id}`)}
      />
    </div>
  );
}

function ShapePanel({ level, kind, item }: { level: Level; kind: "door" | "object"; item: Door | GlobalObject }) {
  const doc = useDoc.getState();
  const title = kind === "door" ? "Door" : "Global object";
  return (
    <div className="panel">
      <h2 className="panel-title">{title}</h2>
      <p className="hint">
        {kind === "door"
          ? "Doors are highlighted for you but never shown in the player window."
          : "Global objects are not tied to a room and are only visible to you."}
      </p>
      <div className="button-grid">
        <ShapeButtons target={{ kind, id: item.id }} />
        <button
          className="danger"
          onClick={() => {
            doc.deleteShape(kind, level.id, item.id);
            select(null);
            useUi.getState().showToast(`${title} deleted — Ctrl/⌘+Z to undo`);
          }}
        >
          🗑 Delete
        </button>
      </div>
      <h3>Description</h3>
      <MarkdownEditor
        key={item.id}
        value={item.description}
        placeholder={kind === "door" ? "Locked? Trapped? Secret?" : "Describe this object…"}
        onChange={(md) => doc.updateShape(kind, level.id, item.id, { description: md }, `${kind}-${item.id}`)}
      />
    </div>
  );
}

function firstLine(md: string) {
  const line = md
    .split("\n")
    .map((l) => l.replace(/^[#>*\-\s]+/, "").replace(/[*_`]/g, "").trim())
    .find((l) => l.length > 0);
  return line ?? "";
}

function LevelOverview({ level }: { level: Level }) {
  const focus = useSession((s) => s.focus);
  const rooms = sortedRooms(level);
  return (
    <div className="panel">
      <h2 className="panel-title">{level.name}</h2>
      <p className="hint">Click a room on the map (or below) to see its descriptions and reveal it to the players.</p>
      <h3>Rooms ({rooms.length})</h3>
      {rooms.length === 0 && <p className="muted">No rooms yet — use “+ Room” in the toolbar.</p>}
      <ul className="entity-list">
        {rooms.map((r) => (
          <li key={r.id}>
            <button onClick={() => select({ kind: "room", id: r.id }, true)}>
              <span className="num" dir="auto">{r.label}</span>
              <span className="desc" dir="auto">
                {r.title.trim() ? r.title : <span className="muted">{roomTitle(r)}</span>}
              </span>
              {r.playerKnown && <span title="Known to players">👁</span>}
              {focus?.roomId === r.id && <span title="Player window focus">◎</span>}
            </button>
          </li>
        ))}
      </ul>
      {level.doors.length > 0 && (
        <>
          <h3>Doors ({level.doors.length})</h3>
          <ul className="entity-list">
            {level.doors.map((d, i) => (
              <li key={d.id}>
                <button onClick={() => select({ kind: "door", id: d.id }, true)}>
                  <span className="num door">D{i + 1}</span>
                  <span className="desc" dir="auto">{firstLine(d.description) || <i className="muted">no description</i>}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {level.objects.length > 0 && (
        <>
          <h3>Global objects ({level.objects.length})</h3>
          <ul className="entity-list">
            {level.objects.map((o, i) => (
              <li key={o.id}>
                <button onClick={() => select({ kind: "object", id: o.id }, true)}>
                  <span className="num object">O{i + 1}</span>
                  <span className="desc" dir="auto">{firstLine(o.description) || <i className="muted">no description</i>}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function SidePanel({ level }: { level: Level }) {
  const selection = useUi((s) => s.selection);
  let content = <LevelOverview level={level} />;
  if (selection?.kind === "room") {
    const room = level.rooms.find((r) => r.id === selection.id);
    if (room) content = <RoomPanel level={level} room={room} />;
  } else if (selection?.kind === "door" || selection?.kind === "object") {
    const list: (Door | GlobalObject)[] = selection.kind === "door" ? level.doors : level.objects;
    const item = list.find((o) => o.id === selection.id);
    if (item) content = <ShapePanel level={level} kind={selection.kind} item={item} />;
  }
  const { width, handleProps } = useResizableWidth("dm.sidePanel", 420, 300, 900, "left");
  return (
    <aside className="side-panel" style={{ width }}>
      <div className="panel-resize left" {...handleProps} />
      <div className="side-panel-scroll">
      {selection && (
        <button className="back-link" onClick={() => select(null)}>
          ← {level.name} overview
        </button>
      )}
      {content}
      </div>
    </aside>
  );
}
