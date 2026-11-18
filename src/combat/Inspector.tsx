/** Right side of the Combat tab: the selected combatant, condition or cheat-sheet entry. */
import { useEffect, useState } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useSession } from "../store/session";
import { applyDamage } from "../lib/combat";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { noteContext } from "../editor/appContext";
import { openDoc } from "../notes/store";
import { resolveStats, type StatsOption } from "../rules/statNotes";
import { statImagePath, statImageUrl } from "../rules/StatNotePane";
import { ConditionText, ConditionView, StatblockView } from "../rules/StatblockView";
import { srdCondition } from "../rules/srd";
import type { CombatCondition, Combatant } from "../types";
import { conditionName, sameImages, setInitiative } from "./actions";
import { ConditionIcon, ConditionInput, StatsInput } from "./pickers";
import { QuickrefItemView } from "./CheatSheet";
import { useCombatUi } from "./store";

const READ_ONLY = [EditorState.readOnly.of(true), EditorView.editable.of(false)];

export function Inspector() {
  const inspect = useCombatUi((s) => s.inspect);
  const combat = useSession((s) => s.combat);
  if (!inspect) {
    return (
      <div className="inspector-empty">
        <p>Click a combatant to see its stats, HP and conditions here.</p>
        <p className="hint">
          Add combatants below the list: <b>Name</b> ⇥ <b>Stats</b> ⇥ <b>HP</b> ⇥ <b>Init</b> ↵. Type initiative in a line's first box (⇥ goes to the
          next line). <kbd>⌘J</kbd> next turn · <kbd>⌘⇧J</kbd> previous.
        </p>
      </div>
    );
  }
  if (inspect.kind === "condition") return <ConditionView id={inspect.id} />;
  if (inspect.kind === "quickref") return <QuickrefItemView section={inspect.section} index={inspect.index} />;
  const c = combat.find((x) => x.id === inspect.id);
  if (!c) return <div className="inspector-empty">This combatant was removed.</div>;
  return <CombatantInspector key={c.id} c={c} highlight={inspect.condition} />;
}

function NumBox({ label, value, onCommit, placeholder, title }: { label: string; value: number | null | undefined; onCommit: (v: number | null) => void; placeholder?: string; title?: string }) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  useEffect(() => setDraft(value == null ? "" : String(value)), [value]);
  const commit = () => {
    const t = draft.trim();
    if (!t) return onCommit(null);
    const n = Number(t);
    if (Number.isFinite(n)) onCommit(Math.round(n));
    else setDraft(value == null ? "" : String(value));
  };
  return (
    <label className="insp-num" title={title}>
      <span>{label}</span>
      <input
        value={draft}
        inputMode="numeric"
        placeholder={placeholder}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
    </label>
  );
}

function HpBox({ c }: { c: Combatant }) {
  const update = (patch: Partial<Combatant>) => useSession.getState().updateCombatant(c.id, patch);
  const [amount, setAmount] = useState("");
  const apply = (sign: 1 | -1) => {
    const n = Math.abs(Number(amount));
    if (!amount.trim() || !Number.isFinite(n)) return;
    update(applyDamage(c, sign * Math.round(n)));
    setAmount("");
  };
  const pct = c.maxHp ? Math.max(0, Math.min(1, c.hp / c.maxHp)) : null;
  return (
    <div className="insp-hp">
      <div className="insp-hp-main">
        <span className={`insp-hp-value ${c.hp <= 0 ? "down" : pct !== null && pct <= 0.5 ? "bloodied" : ""}`}>{c.hp}</span>
        {c.maxHp ? <span className="insp-hp-max">/ {c.maxHp}</span> : null}
        {c.tempHp ? <span className="insp-hp-temp">+{c.tempHp} temp</span> : null}
        <span className="grow" />
        <input
          className="insp-hp-amount"
          value={amount}
          inputMode="numeric"
          placeholder="Amount"
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") apply(e.shiftKey ? -1 : 1);
          }}
          title="↵ damage · ⇧↵ heal"
        />
        <button className="danger" onClick={() => apply(1)} title="Subtract (temporary HP first)">
          Damage
        </button>
        <button onClick={() => apply(-1)} title="Add, up to max HP">
          Heal
        </button>
      </div>
      {pct !== null && (
        <div className="insp-hp-bar">
          <div style={{ width: `${pct * 100}%` }} className={pct <= 0.5 ? "bloodied" : ""} />
        </div>
      )}
      <div className="insp-nums">
        <NumBox label="Init" title="Initiative (the line moves to its place)" value={c.initiative} onCommit={(v) => setInitiative(c.id, v === null ? null : Math.max(-99, Math.min(99, v)))} />
        <NumBox label="AC" value={c.ac} onCommit={(ac) => update({ ac })} />
        <NumBox label="Max HP" value={c.maxHp} onCommit={(maxHp) => update({ maxHp })} />
        <NumBox label="Temp HP" value={c.tempHp || null} placeholder="0" onCommit={(t) => update({ tempHp: t ?? 0 })} />
      </div>
    </div>
  );
}

function ConditionRow({ c, k, open, onToggle }: { c: Combatant; k: CombatCondition; open: boolean; onToggle: () => void }) {
  const s = useSession.getState();
  const rule = k.key === "concentrating" ? null : srdCondition(k.key);
  return (
    <div className={`insp-cond ${open ? "open" : ""}`}>
      <div className="insp-cond-head">
        <button className="insp-cond-name" onClick={onToggle} title={rule ? "Show the rules" : undefined}>
          <ConditionIcon k={k} size={22} />
          <span>{k.key === "exhaustion" ? "Exhaustion" : conditionName(k)}</span>
          {rule && <span className="caret">{open ? "▾" : "▸"}</span>}
        </button>
        <span className="grow" />
        {k.key === "exhaustion" && (
          <span className="insp-level" title="Exhaustion level">
            <button className="icon-btn" disabled={(k.level ?? 1) <= 1} onClick={() => s.updateCondition(c.id, k.id, { level: (k.level ?? 1) - 1 })}>
              −
            </button>
            <b>{k.level ?? 1}</b>
            <button className="icon-btn" disabled={(k.level ?? 1) >= 6} onClick={() => s.updateCondition(c.id, k.id, { level: (k.level ?? 1) + 1 })}>
              +
            </button>
          </span>
        )}
        <label className="insp-rounds" title="Rounds left (counts down at the end of this combatant's turn). Empty = until removed.">
          <input
            value={typeof k.rounds === "number" ? String(k.rounds) : ""}
            placeholder="∞"
            inputMode="numeric"
            onChange={(e) => {
              const n = Number(e.target.value);
              s.updateCondition(c.id, k.id, { rounds: e.target.value.trim() && Number.isFinite(n) && n > 0 ? Math.round(n) : null });
            }}
          />
          <span>rounds</span>
        </label>
        <button className="icon-btn danger-hover" onClick={() => s.removeCondition(c.id, k.id)} title="Remove">
          ✕
        </button>
      </div>
      {open && rule && <ConditionText desc={rule.desc} />}
      {open && k.key === "concentrating" && (
        <p className="hint">Taking damage: Constitution save, DC 10 or half the damage (whichever is higher), or concentration ends.</p>
      )}
    </div>
  );
}

function Conditions({ c, highlight }: { c: Combatant; highlight?: string }) {
  const [open, setOpen] = useState<string | null>(highlight ?? null);
  useEffect(() => setOpen(highlight ?? null), [highlight]);
  const [q, setQ] = useState("");
  return (
    <section className="insp-section">
      <h3>Conditions</h3>
      {(c.conditions ?? []).map((k) => (
        <ConditionRow key={k.id} c={c} k={k} open={open === k.id} onToggle={() => setOpen(open === k.id ? null : k.id)} />
      ))}
      <div className="insp-add-cond">
        <ConditionInput
          value={q}
          onChange={setQ}
          placeholder="✦ Apply condition… (e.g. frightened 3)"
          onPick={(choice) => {
            useSession.getState().addCondition(c.id, choice);
            setQ("");
          }}
        />
      </div>
    </section>
  );
}

function linkStats(c: Combatant, o: StatsOption) {
  const patch: Partial<Combatant> = { stats: o.key, statsName: o.name };
  if (c.ac == null) patch.ac = o.ac;
  if (!c.maxHp && c.hp <= 0) Object.assign(patch, { hp: o.hp, maxHp: o.hp });
  useSession.getState().updateCombatant(c.id, patch);
}

function StatsSection({ c }: { c: Combatant }) {
  const [changing, setChanging] = useState(false);
  const [q, setQ] = useState("");
  const handout = useSession((s) => s.handout);
  const r = resolveStats(c.stats);
  const picker = (
    <StatsInput
      value={q}
      autoFocus
      onChange={setQ}
      placeholder="Type a creature… (yours first, then the SRD)"
      onBlur={() => setChanging(false)}
      onKeyDown={(e) => e.key === "Escape" && setChanging(false)}
      onPick={(o) => {
        linkStats(c, o);
        setChanging(false);
        setQ("");
      }}
    />
  );
  if (!c.stats || changing) {
    return (
      <section className="insp-section">
        <h3>Stats</h3>
        {changing || !c.stats ? picker : null}
        {!changing && <p className="hint">Link a stat block to see it here (and to show the creature's image to the players).</p>}
      </section>
    );
  }
  if (!r) {
    return (
      <section className="insp-section">
        <h3>Stats</h3>
        <p className="error small">The linked stat block “{c.statsName ?? c.stats}” no longer exists.</p>
        <button onClick={() => setChanging(true)}>Link another…</button>
      </section>
    );
  }
  const imagePath = statImagePath(r.sb);
  const showing = imagePath ? sameImages(handout, [imagePath]) : false;
  const openSource = () => (r.source === "note" ? openDoc({ kind: "note", path: r.path! }) : openDoc({ kind: "srd", id: r.key.slice(4) }));
  return (
    <section className="insp-section">
      <StatblockView
        sb={r.sb}
        imageUrl={statImageUrl(r.sb)}
        header={
          <>
            {imagePath && (
              <button
                className={showing ? "active" : ""}
                onClick={() => useSession.getState().showHandout(showing ? null : imagePath)}
                title={showing ? "The players see this creature — click to go back to the map" : "Show this creature's image to the players"}
              >
                {showing ? "🖼 Hide enemy" : "🖼 Show enemy"}
              </button>
            )}
            <button onClick={openSource} title={r.source === "note" ? `Open the note “${r.path}” (edit it there)` : "Open the SRD page in Notes"}>
              {r.source === "note" ? "📝 Open note ↗" : "📖 SRD ↗"}
            </button>
            <button onClick={() => setChanging(true)} title="Link a different stat block">
              Change
            </button>
            <button onClick={() => useSession.getState().updateCombatant(c.id, { stats: null, statsName: undefined })} title="Unlink the stat block">
              Unlink
            </button>
          </>
        }
        below={
          r.source === "note" && r.sb.description.trim() ? (
            <div className="sb-description">
              <MarkdownEditor key={r.path! + r.sb.description.length} value={r.sb.description} onChange={() => {}} context={noteContext(r.path!, "notes")} extensions={READ_ONLY} />
            </div>
          ) : null
        }
      />
      {r.source === "srd" && <p className="hint">SRD stat blocks are read-only. Changing this combatant's HP or AC here never changes the stat block.</p>}
    </section>
  );
}

function CombatantInspector({ c, highlight }: { c: Combatant; highlight?: string }) {
  const update = (patch: Partial<Combatant>) => useSession.getState().updateCombatant(c.id, patch);
  const [note, setNote] = useState(c.note ?? "");
  useEffect(() => setNote(c.note ?? ""), [c.note]);
  return (
    <div className="inspector-combatant">
      <div className="insp-head">
        <h2 dir="auto">{c.name}</h2>
        <button className={`combat-side ${c.side}`} onClick={() => update({ side: c.side === "enemy" ? "party" : "enemy" })}>
          {c.side === "enemy" ? "Enemy" : "Party"}
        </button>
      </div>
      <HpBox c={c} />
      <Conditions c={c} highlight={highlight} />
      <section className="insp-section">
        <h3>Note</h3>
        <textarea
          className="insp-note"
          dir="auto"
          rows={2}
          value={note}
          placeholder="Has the key, fled north…"
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note !== (c.note ?? "") && update({ note: note || undefined })}
        />
      </section>
      <StatsSection c={c} />
    </div>
  );
}
