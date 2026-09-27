import { useNotes, openDoc } from "./store";
import { docTitle } from "./links";
import { DocPane } from "./NotesView";

/** Slide-over on the dungeon tab showing a linked note without leaving the map. */
export function PeekPanel() {
  const peek = useNotes((s) => s.peek);
  if (!peek) return null;
  const close = () => useNotes.getState().set({ peek: null });
  return (
    <div className="peek-panel">
      <div className="peek-header">
        <span className="peek-title" dir="auto">
          {peek.kind === "level" ? "🗺 " : "📝 "}
          {docTitle(peek)}
        </span>
        <span className="grow" />
        <button
          onClick={() => {
            close();
            openDoc(peek);
          }}
          title="Open in the Notes tab"
        >
          Open in Notes ↗
        </button>
        <button className="icon-btn" onClick={close} title="Close (Esc)">
          ✕
        </button>
      </div>
      <DocPane key={peek.kind === "note" ? peek.path : peek.levelId} doc={peek} origin="peek" />
    </div>
  );
}
