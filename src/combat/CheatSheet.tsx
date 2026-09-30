/**
 * Combat cheat sheet, based on crobi/dnd5e-quickref (MIT): movement, actions,
 * bonus actions, reactions, conditions and environment. Click an entry for
 * the details in the inspector.
 */
import { useState } from "react";
import quickref from "../rules/data/quickref.json";
import { iconUrl } from "../rules/srd";
import { useCombatUi } from "./store";

export interface QuickrefItem {
  title: string;
  subtitle: string;
  icon: string | null;
  description: string;
  /** Trusted HTML from the bundled data (italics, a table for exhaustion). */
  bullets: string[];
  reference: string;
}
export interface QuickrefSection {
  id: string;
  title: string;
  items: QuickrefItem[];
}

export const QUICKREF = quickref as QuickrefSection[];

const OPEN_KEY = "combat.cheatsheet.sections";

function loadOpen(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "null");
    return Array.isArray(v) ? v : ["action", "bonus", "reaction", "condition"];
  } catch {
    return ["action", "bonus", "reaction", "condition"];
  }
}

export function CheatSheet() {
  const [open, setOpenState] = useState<string[]>(loadOpen);
  const inspect = useCombatUi((s) => s.inspect);
  const setOpen = (next: string[]) => {
    setOpenState(next);
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  return (
    <aside className="cheat-sheet">
      <div className="cheat-head">
        <span className="cheat-title">Cheat sheet</span>
        <span className="grow" />
        <button className="icon-btn" title="Hide the cheat sheet" onClick={() => useCombatUi.getState().set({ cheatOpen: false })}>
          «
        </button>
      </div>
      <div className="cheat-body">
        {QUICKREF.map((s) => {
          const isOpen = open.includes(s.id);
          return (
            <section key={s.id} className="cheat-section">
              <button className="cheat-section-title" onClick={() => setOpen(isOpen ? open.filter((x) => x !== s.id) : [...open, s.id])}>
                <span className="caret">{isOpen ? "▾" : "▸"}</span> {s.title}
              </button>
              {isOpen && (
                <div className="cheat-items">
                  {s.items.map((it, i) => {
                    const active = inspect?.kind === "quickref" && inspect.section === s.id && inspect.index === i;
                    return (
                      <button
                        key={i}
                        className={`cheat-item ${active ? "active" : ""}`}
                        title={it.description}
                        onClick={() => useCombatUi.getState().set({ inspect: { kind: "quickref", section: s.id, index: i } })}
                      >
                        {it.icon ? <img className="rules-icon" src={iconUrl(it.icon)} alt="" /> : <span className="rules-icon" />}
                        <span className="cheat-item-text">
                          <b>{it.title}</b>
                          <span>{it.subtitle}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
        <p className="hint cheat-credit">Based on dnd5e-quickref by crobi (MIT). Icons: game-icons.net (CC BY 3.0).</p>
      </div>
    </aside>
  );
}

export function QuickrefItemView({ section, index }: { section: string; index: number }) {
  const s = QUICKREF.find((x) => x.id === section);
  const it = s?.items[index];
  if (!s || !it) return null;
  return (
    <div className="quickref-item">
      <div className="condition-head">
        {it.icon && <img className="rules-icon big" src={iconUrl(it.icon)} alt="" />}
        <div>
          <div className="muted small">{s.title}</div>
          <h2>{it.title}</h2>
        </div>
      </div>
      <p className="quickref-desc">{it.description}</p>
      <ul className="quickref-bullets">
        {it.bullets.map((b, i) => (
          <li key={i} dangerouslySetInnerHTML={{ __html: b }} />
        ))}
      </ul>
      {it.reference && <p className="hint">{it.reference}</p>}
    </div>
  );
}
