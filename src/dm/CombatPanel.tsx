import { useEffect, useRef, useState } from "react";
import { useSession } from "../store/session";
import { applyHpInput, parseStartingHp } from "../lib/combat";
import { confirmAsync } from "../components/ui";
import type { Combatant } from "../types";

const MIN_KEY = "dm.combat.minimized";

function loadMinimized(): boolean {
  try {
    return localStorage.getItem(MIN_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * The DM's combat tracker: one line per combatant (name → HP), red for
 * enemies and green for the party, in turn order. Never shown to players.
 */
export function CombatPanel() {
  const combat = useSession((s) => s.combat);
  const [minimized, setMinimized] = useState(loadMinimized);
  useEffect(() => {
    try {
      localStorage.setItem(MIN_KEY, minimized ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [minimized]);

  if (minimized) {
    return (
      <button className="combat-pill" onClick={() => setMinimized(false)} title="Show the combat tracker">
        ⚔ Combat{combat.length ? ` (${combat.length})` : ""}
      </button>
    );
  }

  const enemies = combat.filter((c) => c.side === "enemy").length;
  const clearEnemies = async () => {
    const ok = await confirmAsync(
      <>
        Remove all {enemies} enem{enemies === 1 ? "y" : "ies"} from the combat tracker? Party members stay.
      </>,
      { confirmLabel: "Clear enemies", danger: true },
    );
    if (ok) useSession.getState().clearEnemies();
  };

  return (
    <div className="combat-panel">
      <div className="combat-header">
        <span className="combat-title">⚔ Combat</span>
        <span className="grow" />
        {enemies > 0 && (
          <button className="combat-clear" onClick={() => void clearEnemies()} title="Remove every enemy, keep the party">
            Clear enemies
          </button>
        )}
        <button className="icon-btn" title="Minimize" onClick={() => setMinimized(true)}>
          ▁
        </button>
      </div>
      <CombatList combat={combat} />
      <AddCombatant />
    </div>
  );
}

function CombatList({ combat }: { combat: Combatant[] }) {
  const listRef = useRef<HTMLDivElement>(null);
  const [drag, setDragState] = useState<{ id: string; index: number } | null>(null);
  const dragRef = useRef(drag);
  const setDrag = (d: { id: string; index: number } | null) => {
    dragRef.current = d;
    setDragState(d);
  };

  // Drag by the grip: follow the pointer and show where the line will land.
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const rows = [...(listRef.current?.querySelectorAll<HTMLElement>(".combat-row") ?? [])];
      let index = rows.length;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i].getBoundingClientRect();
        if (e.clientY < r.top + r.height / 2) {
          index = i;
          break;
        }
      }
      const d = dragRef.current;
      if (d && d.index !== index) setDrag({ ...d, index });
    };
    const up = () => {
      const d = dragRef.current;
      setDrag(null);
      if (!d) return;
      const from = useSession.getState().combat.findIndex((c) => c.id === d.id);
      // Dropping below its own position: account for the removed line.
      useSession.getState().moveCombatant(d.id, d.index > from ? d.index - 1 : d.index);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!combat.length) return <div className="combat-empty">No combatants. Add one below.</div>;
  return (
    <div className={`combat-list ${drag ? "dragging" : ""}`} ref={listRef}>
      {combat.map((c, i) => (
        <div key={c.id}>
          {drag && drag.index === i && <div className="combat-drop" />}
          <CombatRow c={c} dragging={drag?.id === c.id} onGrab={() => setDrag({ id: c.id, index: i })} />
        </div>
      ))}
      {drag && drag.index === combat.length && <div className="combat-drop" />}
    </div>
  );
}

function CombatRow({ c, dragging, onGrab }: { c: Combatant; dragging: boolean; onGrab: () => void }) {
  const update = (patch: Partial<Omit<Combatant, "id">>) => useSession.getState().updateCombatant(c.id, patch);
  const [name, setName] = useState(c.name);
  const [hp, setHp] = useState(String(c.hp));
  useEffect(() => setName(c.name), [c.name]);
  useEffect(() => setHp(String(c.hp)), [c.hp]);

  const commitHp = () => {
    const next = applyHpInput(c.hp, hp);
    if (next === null) setHp(String(c.hp));
    else {
      update({ hp: next });
      setHp(String(next));
    }
  };
  const commitName = () => {
    const n = name.trim();
    if (n && n !== c.name) update({ name: n });
    else setName(c.name);
  };

  return (
    <div className={`combat-row ${c.side} ${c.hp <= 0 ? "down" : ""} ${dragging ? "dragged" : ""}`}>
      <span
        className="combat-grip"
        title="Drag to reorder"
        onPointerDown={(e) => {
          e.preventDefault();
          onGrab();
        }}
      >
        ⋮⋮
      </span>
      <button
        className="combat-side"
        onClick={() => update({ side: c.side === "enemy" ? "party" : "enemy" })}
        title={c.side === "enemy" ? "Enemy — click to make it a party member" : "Party member — click to make it an enemy"}
      >
        {c.side === "enemy" ? "Enemy" : "Party"}
      </button>
      <input
        className="combat-name"
        dir="auto"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setName(c.name);
            e.currentTarget.blur();
          }
        }}
      />
      <input
        className="combat-hp"
        value={hp}
        inputMode="numeric"
        title="HP — type -7 to subtract, +5 to add, or a number to set (↑/↓ change by 1)"
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setHp(e.target.value)}
        onBlur={commitHp}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setHp(String(c.hp));
            e.currentTarget.blur();
          }
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const next = c.hp + (e.key === "ArrowUp" ? 1 : -1);
            update({ hp: next });
            setHp(String(next));
            requestAnimationFrame(() => e.currentTarget?.select());
          }
        }}
      />
      <button className="combat-delete" onClick={() => useSession.getState().removeCombatant(c.id)} title="Remove">
        ✕
      </button>
    </div>
  );
}

/** Name ⇥ HP ↵ — then ready for the next one. */
function AddCombatant() {
  const [name, setName] = useState("");
  const [hp, setHp] = useState("");
  const [error, setError] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const hpRef = useRef<HTMLInputElement>(null);

  const add = () => {
    const n = name.trim();
    const value = parseStartingHp(hp);
    if (!n) return nameRef.current?.focus();
    if (value === null) {
      setError(true);
      return hpRef.current?.focus();
    }
    useSession.getState().addCombatant(n, value);
    setName("");
    setHp("");
    setError(false);
    nameRef.current?.focus();
  };

  return (
    <form
      className="combat-add"
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
    >
      <input
        ref={nameRef}
        dir="auto"
        placeholder="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (name.trim()) hpRef.current?.focus();
          }
        }}
      />
      <input
        ref={hpRef}
        className={`combat-hp ${error ? "invalid" : ""}`}
        placeholder="HP"
        inputMode="numeric"
        value={hp}
        onChange={(e) => {
          setHp(e.target.value);
          setError(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
      />
      <button type="submit" title="Add (Enter)">
        ＋
      </button>
    </form>
  );
}
