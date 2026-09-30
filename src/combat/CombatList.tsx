/**
 * The combatant list: one line per combatant in turn order, red for enemies
 * and green for the party. Used full-size on the Combat tab and compact on
 * the Dungeon view.
 */
import { useEffect, useRef, useState } from "react";
import { useSession } from "../store/session";
import { applyHpInput, parseStartingHp } from "../lib/combat";
import { resolveStats, type StatsOption } from "../rules/statNotes";
import type { CombatCondition, Combatant } from "../types";
import { addFromRow, conditionName } from "./actions";
import { ConditionIcon, ConditionInput, StatsInput } from "./pickers";
import { inspectCombatant, useCombatUi } from "./store";

export function CombatList({ compact, onStats }: { compact?: boolean; onStats?: (c: Combatant) => void }) {
  const combat = useSession((s) => s.combat);
  const turn = useSession((s) => s.turn);
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
    <div className={`combat-list ${compact ? "compact" : ""} ${drag ? "dragging" : ""}`} ref={listRef}>
      {combat.map((c, i) => (
        <div key={c.id}>
          {drag && drag.index === i && <div className="combat-drop" />}
          <CombatRow c={c} compact={compact} isTurn={turn === c.id} dragging={drag?.id === c.id} onGrab={() => setDrag({ id: c.id, index: i })} onStats={onStats} />
        </div>
      ))}
      {drag && drag.index === combat.length && <div className="combat-drop" />}
    </div>
  );
}

function hpClass(c: Combatant): string {
  if (c.hp <= 0) return "down";
  if (c.maxHp && c.hp <= c.maxHp / 2) return "bloodied";
  return "";
}

export function ConditionIcons({ c, max, onClick }: { c: Combatant; max?: number; onClick?: (k: CombatCondition) => void }) {
  const list = c.conditions ?? [];
  if (!list.length) return null;
  const shown = max !== undefined && list.length > max ? list.slice(0, max) : list;
  const title = (k: CombatCondition) =>
    `${conditionName(k)}${typeof k.rounds === "number" ? ` (${k.rounds} round${k.rounds === 1 ? "" : "s"} left)` : ""}\nClick for the rules · right-click to remove`;
  return (
    <span className="cond-icons">
      {shown.map((k) => (
        <button
          key={k.id}
          className="cond-icon"
          title={title(k)}
          onClick={(e) => {
            e.stopPropagation();
            onClick?.(k);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            useSession.getState().removeCondition(c.id, k.id);
          }}
        >
          <ConditionIcon k={k} />
          {k.key === "exhaustion" && k.level ? <sub>{k.level}</sub> : null}
          {typeof k.rounds === "number" ? <sup>{k.rounds}</sup> : null}
        </button>
      ))}
      {shown.length < list.length && <span className="cond-more">+{list.length - shown.length}</span>}
    </span>
  );
}

/** "Apply condition" button with an autocomplete popover. */
export function ApplyCondition({ c }: { c: Combatant }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  return (
    <span className="apply-cond">
      <button
        className="apply-cond-btn"
        title="Apply condition (type a name; add a number for rounds, e.g. “frightened 3”)"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
          setQ("");
        }}
      >
        ✦
      </button>
      {open && (
        <span className="apply-cond-pop" onClick={(e) => e.stopPropagation()}>
          <ConditionInput
            value={q}
            onChange={setQ}
            autoFocus
            placeholder="Condition… (frightened 3)"
            onBlur={() => setOpen(false)}
            onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
            onPick={(choice) => {
              useSession.getState().addCondition(c.id, choice);
              setOpen(false);
            }}
          />
        </span>
      )}
    </span>
  );
}

function CombatRow({
  c,
  compact,
  isTurn,
  dragging,
  onGrab,
  onStats,
}: {
  c: Combatant;
  compact?: boolean;
  isTurn: boolean;
  dragging: boolean;
  onGrab: () => void;
  onStats?: (c: Combatant) => void;
}) {
  const update = (patch: Partial<Omit<Combatant, "id">>) => useSession.getState().updateCombatant(c.id, patch);
  const selected = useCombatUi((s) => !compact && s.inspect?.kind === "combatant" && s.inspect.id === c.id);
  const [name, setName] = useState(c.name);
  const [hp, setHp] = useState(String(c.hp));
  const [ac, setAc] = useState(c.ac === null || c.ac === undefined ? "" : String(c.ac));
  useEffect(() => setName(c.name), [c.name]);
  useEffect(() => setHp(String(c.hp)), [c.hp]);
  useEffect(() => setAc(c.ac === null || c.ac === undefined ? "" : String(c.ac)), [c.ac]);
  const stats = resolveStats(c.stats);
  const statsName = stats?.sb.name ?? c.statsName;

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
  const commitAc = () => {
    const t = ac.trim();
    if (!t) return update({ ac: null });
    const n = Number(t);
    if (Number.isFinite(n)) update({ ac: Math.round(n) });
    else setAc(c.ac === null || c.ac === undefined ? "" : String(c.ac));
  };
  const blurOnEnter = (reset: () => void) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
    if (e.key === "Escape") {
      reset();
      e.currentTarget.blur();
    }
  };

  return (
    <div
      className={`combat-row ${c.side} ${hpClass(c)} ${dragging ? "dragged" : ""} ${isTurn ? "turn" : ""} ${selected ? "selected" : ""}`}
      onClick={() => !compact && inspectCombatant(c.id)}
    >
      <span className="combat-turn" title={isTurn ? "Their turn" : undefined}>
        {isTurn ? "▶" : ""}
      </span>
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
      {!compact && (
        <button
          className="combat-side"
          onClick={(e) => {
            e.stopPropagation();
            update({ side: c.side === "enemy" ? "party" : "enemy" });
          }}
          title={c.side === "enemy" ? "Enemy — click to make it a party member" : "Party member — click to make it an enemy"}
        >
          {c.side === "enemy" ? "Enemy" : "Party"}
        </button>
      )}
      <span className={compact ? "combat-name-cell compact" : "combat-name-cell"}>
      <input
          className="combat-name"
          dir="auto"
          size={compact ? undefined : Math.max(4, Math.min(28, name.length + 1))}
          value={name}
          title={compact && statsName ? `${c.name} — ${statsName}` : undefined}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={blurOnEnter(() => setName(c.name))}
        />
      </span>
      {!compact && (
        <button
          className={`combat-stats ${statsName ? "" : "empty"} ${c.stats && !stats ? "missing" : ""}`}
          title={stats ? `Show the ${stats.sb.name} stat block` : c.stats ? "This stat block no longer exists" : "Link a stat block"}
          onClick={(e) => {
            e.stopPropagation();
            onStats?.(c);
          }}
        >
          {statsName ?? "+ stats"}
        </button>
      )}
      {compact && stats && (
        <button className="combat-stats-icon" title={`${stats.sb.name} stat block`} onClick={() => onStats?.(c)}>
          📜
        </button>
      )}
      <ConditionIcons c={c} max={compact ? 3 : undefined} onClick={(k) => (compact ? onStats?.(c) : inspectCombatant(c.id, k.id))} />
      {!compact && <ApplyCondition c={c} />}
      {!compact && <span className="grow combat-row-space" />}
      <label className="combat-ac" title="Armor Class" onClick={(e) => e.stopPropagation()}>
        <span>AC</span>
        <input value={ac} inputMode="numeric" onFocus={(e) => e.currentTarget.select()} onChange={(e) => setAc(e.target.value)} onBlur={commitAc} onKeyDown={blurOnEnter(() => setAc(c.ac == null ? "" : String(c.ac)))} />
      </label>
      <span className="combat-hp-wrap" onClick={(e) => e.stopPropagation()}>
        <input
          className="combat-hp"
          value={hp}
          inputMode="numeric"
          title="HP — type -7 to subtract, +5 to add, or a number to set (↑/↓ change by 1)"
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setHp(e.target.value)}
          onBlur={commitHp}
          onKeyDown={(e) => {
            blurOnEnter(() => setHp(String(c.hp)))(e);
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              const next = c.hp + (e.key === "ArrowUp" ? 1 : -1);
              update({ hp: next });
              setHp(String(next));
              requestAnimationFrame(() => e.currentTarget?.select());
            }
          }}
        />
        {c.maxHp ? <span className="combat-max">/{c.maxHp}</span> : null}
        {c.tempHp ? <span className="combat-temp" title="Temporary HP">+{c.tempHp}</span> : null}
      </span>
      <button
        className="combat-delete"
        onClick={(e) => {
          e.stopPropagation();
          useSession.getState().removeCombatant(c.id);
        }}
        title="Remove"
      >
        ✕
      </button>
    </div>
  );
}

/** Name ⇥ Stats ⇥ HP ↵ — then ready for the next one. "Goblin x4" adds four. */
export function AddCombatant({ compact }: { compact?: boolean }) {
  const [name, setName] = useState("");
  const [statsText, setStatsText] = useState("");
  const [stats, setStats] = useState<StatsOption | null>(null);
  const [hp, setHp] = useState("");
  const [hpAuto, setHpAuto] = useState(false);
  const [error, setError] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const statsRef = useRef<HTMLInputElement>(null);
  const hpRef = useRef<HTMLInputElement>(null);

  const pick = (o: StatsOption) => {
    setStats(o);
    setStatsText(o.name);
    if (!hp.trim() || hpAuto) {
      setHp(String(o.hp));
      setHpAuto(true);
    }
    requestAnimationFrame(() => {
      hpRef.current?.focus();
      hpRef.current?.select();
    });
  };

  const add = () => {
    const value = parseStartingHp(hp);
    if (!name.trim() && !stats) return nameRef.current?.focus();
    if (value === null) {
      setError(true);
      return hpRef.current?.focus();
    }
    const ids = addFromRow(name, stats, value);
    if (ids.length && !compact) inspectCombatant(ids[ids.length - 1]);
    setName("");
    setStatsText("");
    setStats(null);
    setHp("");
    setHpAuto(false);
    setError(false);
    nameRef.current?.focus();
  };

  return (
    <form
      className={`combat-add ${compact ? "compact" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
    >
      <input
        ref={nameRef}
        className="combat-add-name"
        dir="auto"
        placeholder={compact ? "Name" : "Name (Goblin x4 adds four)"}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            statsRef.current?.focus();
          }
        }}
      />
      <StatsInput
        inputRef={statsRef}
        className={`combat-add-stats ${stats ? "linked" : ""}`}
        placeholder="Stats"
        title="Optional: link a stat block (yours first, then the SRD). Fills AC and HP."
        value={statsText}
        onChange={(v) => {
          setStatsText(v);
          if (stats && v !== stats.name) setStats(null);
        }}
        onPick={(o) => pick(o)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            hpRef.current?.focus();
          }
        }}
      />
      <input
        ref={hpRef}
        className={`combat-hp ${error ? "invalid" : ""}`}
        placeholder="HP"
        inputMode="numeric"
        value={hp}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          setHp(e.target.value);
          setHpAuto(false);
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
