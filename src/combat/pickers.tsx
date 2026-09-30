/** Autocomplete inputs: stats (stat blocks) and conditions. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { fuzzyScore } from "../notes/QuickSwitcher";
import { statsOptions, type StatsOption } from "../rules/statNotes";
import { CONDITION_ICONS, SRD_CONDITION_LIST, iconUrl } from "../rules/srd";
import { useNotes } from "../notes/store";
import type { CombatCondition } from "../types";

const LIST_MAX = 320;
const MARGIN = 8;

/**
 * Where the suggestion list goes: below the input, or above it when there is
 * more room there; its height shrinks to fit, and it never leaves the window.
 */
export function listPosition(rect: DOMRect): React.CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const below = vh - rect.bottom - MARGIN - 2;
  const above = rect.top - MARGIN - 2;
  const up = below < Math.min(LIST_MAX, 160) && above > below;
  const maxHeight = Math.max(80, Math.min(LIST_MAX, up ? above : below));
  const minWidth = Math.min(Math.max(rect.width, 240), vw - 2 * MARGIN);
  const maxWidth = Math.min(460, vw - 2 * MARGIN);
  const left = Math.max(MARGIN, Math.min(rect.left, vw - MARGIN - Math.max(minWidth, Math.min(maxWidth, 360))));
  return up ? { left, bottom: vh - rect.top + 2, maxHeight, minWidth, maxWidth } : { left, top: rect.bottom + 2, maxHeight, minWidth, maxWidth };
}

interface SuggestProps<T> {
  value: string;
  onChange: (v: string) => void;
  items: T[];
  itemKey: (t: T) => string;
  render: (t: T) => ReactNode;
  onPick: (t: T, via: "enter" | "tab" | "click") => void;
  placeholder?: string;
  className?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  autoFocus?: boolean;
  /** Show suggestions while the input is empty too. */
  openEmpty?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onBlur?: () => void;
  title?: string;
}

/** A text input with a keyboard-driven suggestion list (↑ ↓, ↵ or ⇥ picks, esc closes). */
export function SuggestInput<T>({ value, onChange, items, itemKey, render, onPick, placeholder, className, inputRef, autoFocus, openEmpty, onKeyDown, onBlur, title }: SuggestProps<T>) {
  const own = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? own;
  const [focused, setFocused] = useState(false);
  const [closed, setClosed] = useState(false);
  const [sel, setSel] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const open = focused && !closed && items.length > 0 && (openEmpty || value.trim().length > 0);
  useEffect(() => setSel(0), [value]);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus, ref]);
  useLayoutEffect(() => {
    if (open && ref.current) setRect(ref.current.getBoundingClientRect());
  }, [open, value, ref]);

  return (
    <>
      <input
        ref={ref}
        dir="auto"
        className={className}
        value={value}
        placeholder={placeholder}
        title={title}
        onChange={(e) => {
          onChange(e.target.value);
          setClosed(false);
        }}
        onFocus={() => {
          setFocused(true);
          setClosed(false);
        }}
        onBlur={() => {
          setFocused(false);
          onBlur?.();
        }}
        onKeyDown={(e) => {
          if (open && e.key === "ArrowDown") {
            e.preventDefault();
            setSel((s) => Math.min(items.length - 1, s + 1));
            return;
          }
          if (open && e.key === "ArrowUp") {
            e.preventDefault();
            setSel((s) => Math.max(0, s - 1));
            return;
          }
          if (open && e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setClosed(true);
            return;
          }
          if (open && (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) && items[sel]) {
            e.preventDefault();
            setClosed(true);
            onPick(items[sel], e.key === "Enter" ? "enter" : "tab");
            return;
          }
          onKeyDown?.(e);
        }}
      />
      {open &&
        rect &&
        createPortal(
          <ul className="suggest-list" style={listPosition(rect)} onMouseDown={(e) => e.preventDefault()}>
            {items.map((t, i) => (
              <li
                key={itemKey(t)}
                className={i === sel ? "sel" : ""}
                onMouseEnter={() => setSel(i)}
                onClick={() => {
                  setClosed(true);
                  onPick(t, "click");
                }}
              >
                {render(t)}
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </>
  );
}

// ---- stats --------------------------------------------------------------------------------

/** Stat blocks matching `q`: the DM's own first, then the SRD. */
export function matchStats(q: string, all: StatsOption[], limit = 30): StatsOption[] {
  const query = q.trim();
  if (!query) return all.filter((o) => o.source === "note").slice(0, limit);
  const scored = all.map((o) => ({ o, s: fuzzyScore(o.name, query) })).filter((x) => x.s >= 0);
  const rank = (src: StatsOption["source"]) =>
    scored
      .filter((x) => x.o.source === src)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.o);
  return [...rank("note"), ...rank("srd")].slice(0, limit);
}

export function useStatsOptions(): StatsOption[] {
  const files = useNotes((s) => s.files);
  return useMemo(() => statsOptions(), [files]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function StatsOptionRow({ o }: { o: StatsOption }) {
  return (
    <>
      <span className="grow ellipsis" dir="auto">
        {o.name}
      </span>
      <span className={`suggest-tag ${o.source}`}>{o.source === "note" ? "custom" : "SRD"}</span>
      <span className="suggest-meta">
        {o.detail.split(" · ")[1]} · AC {o.ac} · HP {o.hp}
      </span>
    </>
  );
}

export function StatsInput(props: Omit<SuggestProps<StatsOption>, "items" | "itemKey" | "render">) {
  const all = useStatsOptions();
  const items = useMemo(() => matchStats(props.value, all), [props.value, all]);
  return <SuggestInput {...props} items={items} itemKey={(o) => o.key} render={(o) => <StatsOptionRow o={o} />} />;
}

// ---- conditions -----------------------------------------------------------------------------

export type ConditionChoice = Omit<CombatCondition, "id">;

interface ConditionOption {
  key: string;
  name: string;
  choice: ConditionChoice;
}

const BASE_CONDITIONS = [...SRD_CONDITION_LIST.map((c) => ({ key: c.id, name: c.name })), { key: "concentrating", name: "Concentrating" }].sort((a, b) =>
  a.name.localeCompare(b.name),
);

/** "frightened 3" → Frightened for 3 rounds; "exhaustion 2" → level 2; anything else can be a custom tag. */
export function conditionOptions(q: string): ConditionOption[] {
  const m = /^(.*?)\s+(\d+)$/.exec(q.trim());
  const text = (m ? m[1] : q).trim();
  const n = m ? Number(m[2]) : null;
  const make = (key: string, name: string): ConditionOption => {
    const choice: ConditionChoice = { key };
    if (key === "exhaustion") choice.level = Math.max(1, Math.min(6, n ?? 1));
    else if (n) choice.rounds = n;
    return { key, name, choice };
  };
  const list = text
    ? BASE_CONDITIONS.map((c) => ({ c, s: fuzzyScore(c.name, text) }))
        .filter((x) => x.s >= 0)
        .sort((a, b) => b.s - a.s)
        .map((x) => make(x.c.key, x.c.name))
    : BASE_CONDITIONS.map((c) => make(c.key, c.name));
  if (text && !BASE_CONDITIONS.some((c) => c.name.toLowerCase() === text.toLowerCase())) {
    const custom: ConditionOption = { key: `custom:${text}`, name: text, choice: { key: "custom", label: text, ...(n ? { rounds: n } : {}) } };
    list.push(custom);
  }
  return list;
}

export function ConditionIcon({ k, size = 18 }: { k: Pick<CombatCondition, "key" | "label">; size?: number }) {
  const icon = CONDITION_ICONS[k.key];
  if (icon) return <img className="rules-icon" src={iconUrl(icon)} alt="" style={{ width: size, height: size }} />;
  return (
    <span className="cond-badge" style={{ height: size, minWidth: size, fontSize: size * 0.55 }}>
      {(k.label || "?").slice(0, 2)}
    </span>
  );
}

export function ConditionInput(props: Omit<SuggestProps<ConditionOption>, "items" | "itemKey" | "render" | "onPick"> & { onPick: (c: ConditionChoice) => void }) {
  const items = useMemo(() => conditionOptions(props.value), [props.value]);
  return (
    <SuggestInput
      {...props}
      openEmpty
      items={items}
      itemKey={(o) => o.key}
      onPick={(o) => props.onPick(o.choice)}
      render={(o) => (
        <>
          <ConditionIcon k={o.choice} />
          <span className="grow">{o.key.startsWith("custom:") ? `Custom: “${o.name}”` : o.name}</span>
          {o.choice.rounds ? <span className="suggest-meta">{o.choice.rounds} rounds</span> : null}
          {o.choice.level ? <span className="suggest-meta">level {o.choice.level}</span> : null}
        </>
      )}
    />
  );
}
