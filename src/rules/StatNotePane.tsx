/** A stat block note in Notes: the stat block (view or edit form) and its description. */
import { useEffect, useState } from "react";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { Modal } from "../components/ui";
import { noteContext, resolveEmbed } from "../editor/appContext";
import { NoteEditor } from "../notes/editors";
import { setNoteContent, useNotes } from "../notes/store";
import type { Origin } from "../notes/nav";
import { useUi } from "../store/ui";
import { parseStatblockText } from "./pasteStatblock";
import { ABILITIES, abilityMod, formatMod, parseStatNote, replaceStatNoteBlock, replaceStatNoteBody, type StatEntry, type Statblock } from "./statblock";
import { StatblockView } from "./StatblockView";
import { editOnOpen } from "./statNotes";

export function statImageUrl(sb: Statblock): string | null {
  return sb.image ? (resolveEmbed(sb.image)?.url ?? null) : null;
}

export function statImagePath(sb: Statblock): string | null {
  return sb.image ? (resolveEmbed(sb.image)?.path ?? null) : null;
}

export function StatNotePane({ path, origin }: { path: string; origin: Origin }) {
  const text = useNotes((s) => s.files[path]) ?? "";
  const [editing, setEditing] = useState(() => editOnOpen.delete(path));
  const [pasting, setPasting] = useState(false);
  const parsed = parseStatNote(text);
  const context = noteContext(path, origin);
  useNotes((s) => s.attachments); // redraw when the image arrives

  if (!parsed.statblock) {
    return (
      <>
        <div className="error small">This stat block can't be read ({parsed.error}). Fix the text below.</div>
        <NoteEditor path={path} origin={origin} />
      </>
    );
  }
  const sb = parsed.statblock;
  const save = (next: Statblock) => setNoteContent(path, replaceStatNoteBlock(useNotes.getState().files[path] ?? text, next));

  return (
    <div className="stat-note">
      {editing ? (
        <StatblockForm sb={sb} onChange={save} context={context} onDone={() => setEditing(false)} onPaste={() => setPasting(true)} />
      ) : (
        <StatblockView
          sb={sb}
          imageUrl={statImageUrl(sb)}
          header={
            <>
              <button onClick={() => setEditing(true)} title="Edit the stat block">
                ✎ Edit
              </button>
              <button onClick={() => setPasting(true)} title="Fill the stat block from text copied from D&D Beyond or a book">
                📋 Paste
              </button>
            </>
          }
        />
      )}
      <h3 className="stat-note-desc-title">Description</h3>
      <MarkdownEditor
        key={path}
        className="stat-note-desc"
        value={parsed.body}
        context={context}
        placeholder="Tactics, personality, where it lairs… ([[ to link)"
        onChange={(body) => setNoteContent(path, replaceStatNoteBody(useNotes.getState().files[path] ?? text, body))}
      />
      {pasting && (
        <PasteDialog
          onClose={() => setPasting(false)}
          onPaste={(pasted) => {
            save({ ...pasted, image: sb.image, description: sb.description });
            setPasting(false);
            setEditing(true);
            useUi.getState().showToast("Filled from the pasted text — check the fields.");
          }}
        />
      )}
    </div>
  );
}

// ---- paste ------------------------------------------------------------------------------------

function PasteDialog({ onClose, onPaste }: { onClose: () => void; onPaste: (sb: Statblock) => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const go = () => {
    const sb = parseStatblockText(text);
    if (!sb) return setError("That doesn't look like a stat block. Copy it from the name down to the last action.");
    onPaste(sb);
  };
  return (
    <Modal
      title="Paste a stat block"
      onClose={onClose}
      size="large"
      footer={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={go} disabled={!text.trim()}>
            Fill the stat block
          </button>
        </>
      }
    >
      <p className="hint">
        Copy a stat block from D&D Beyond or a book (from the creature's name to its last action) and paste it here. It replaces the current
        stat block; the description and image are kept.
      </p>
      <textarea
        className="paste-area"
        autoFocus
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        placeholder={"Goblin\nSmall humanoid (goblinoid), neutral evil\nArmor Class 15 (leather armor, shield)\n…"}
      />
      {error && <div className="error small">{error}</div>}
    </Modal>
  );
}

// ---- form -------------------------------------------------------------------------------------

const SIZES = ["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"];
const CRS = ["0", "1/8", "1/4", "1/2", ...Array.from({ length: 30 }, (_, i) => String(i + 1))];

function Text({ label, value, onChange, wide, placeholder }: { label: string; value: string; onChange: (v: string) => void; wide?: boolean; placeholder?: string }) {
  return (
    <label className={`sbf-field ${wide ? "wide" : ""}`}>
      <span>{label}</span>
      <input dir="auto" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/** Number input that allows being empty while typing. */
function Num({ label, value, onChange, min = 0, max = 9999 }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <label className="sbf-field num">
      <span>{label}</span>
      <input
        inputMode="numeric"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() && Number.isFinite(n)) onChange(Math.max(min, Math.min(max, Math.round(n))));
        }}
        onBlur={() => setDraft(String(value))}
      />
    </label>
  );
}

function EntryList({ title, list, onChange, addLabel }: { title: string; list: StatEntry[]; onChange: (l: StatEntry[]) => void; addLabel: string }) {
  const set = (i: number, patch: Partial<StatEntry>) => onChange(list.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const move = (i: number, d: number) => {
    const next = [...list];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    onChange(next);
  };
  return (
    <div className="sbf-list">
      <h4>{title}</h4>
      {list.map((e, i) => (
        <div key={i} className="sbf-entry">
          <div className="sbf-entry-head">
            <input dir="auto" className="grow" value={e.name} placeholder="Name" onChange={(ev) => set(i, { name: ev.target.value })} />
            <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} title="Move up">
              ↑
            </button>
            <button className="icon-btn" disabled={i === list.length - 1} onClick={() => move(i, 1)} title="Move down">
              ↓
            </button>
            <button className="icon-btn danger-hover" onClick={() => onChange(list.filter((_, j) => j !== i))} title="Remove">
              ✕
            </button>
          </div>
          <textarea dir="auto" value={e.desc} placeholder="Description" rows={Math.min(8, Math.max(2, Math.ceil(e.desc.length / 70)))} onChange={(ev) => set(i, { desc: ev.target.value })} />
        </div>
      ))}
      <button className="sbf-add" onClick={() => onChange([...list, { name: "", desc: "" }])}>
        ＋ {addLabel}
      </button>
    </div>
  );
}

export function StatblockForm({
  sb,
  onChange,
  context,
  onDone,
  onPaste,
}: {
  sb: Statblock;
  onChange: (sb: Statblock) => void;
  context: ReturnType<typeof noteContext>;
  onDone: () => void;
  onPaste: () => void;
}) {
  const set = (patch: Partial<Statblock>) => onChange({ ...sb, ...patch });
  const imageUrl = statImageUrl(sb);
  const pickImage = async () => {
    try {
      const md = await context.pickImage();
      const m = md && /!\[\[([^\]|]+)/.exec(md);
      if (m) set({ image: m[1] });
    } catch (e) {
      useUi.getState().showToast(`Could not add image: ${e}`);
    }
  };
  return (
    <div className="sb-form">
      <div className="sbf-top">
        <h3>Edit stat block</h3>
        <span className="grow" />
        <button onClick={onPaste} title="Fill from text copied from D&D Beyond or a book">
          📋 Paste
        </button>
        <button className="primary" onClick={onDone}>
          ✓ Done
        </button>
      </div>
      <div className="sbf-grid">
        <Text label="Name" value={sb.name} onChange={(name) => set({ name })} wide />
        <label className="sbf-field">
          <span>Size</span>
          <select value={sb.size} onChange={(e) => set({ size: e.target.value })}>
            {(SIZES.includes(sb.size) ? SIZES : [sb.size, ...SIZES]).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <Text label="Type" value={sb.type} onChange={(type) => set({ type })} placeholder="humanoid (goblinoid)" />
        <Text label="Alignment" value={sb.alignment} onChange={(alignment) => set({ alignment })} placeholder="neutral evil" />
        <Num label="Armor Class" value={sb.ac} onChange={(ac) => set({ ac })} max={40} />
        <Text label="Armor" value={sb.acNote} onChange={(acNote) => set({ acNote })} placeholder="leather armor, shield" />
        <Num label="Hit Points" value={sb.hp} onChange={(hp) => set({ hp })} max={99999} />
        <Text label="Hit Dice" value={sb.hitDice} onChange={(hitDice) => set({ hitDice })} placeholder="2d6" />
        <Text label="Speed" value={sb.speed} onChange={(speed) => set({ speed })} wide />
      </div>
      <div className="sbf-abilities">
        {ABILITIES.map((a, i) => (
          <div key={a}>
            <Num
              label={a}
              value={sb.stats[i]}
              max={30}
              onChange={(v) => {
                const stats = [...sb.stats] as Statblock["stats"];
                stats[i] = v;
                set({ stats });
              }}
            />
            <span className="muted">{formatMod(abilityMod(sb.stats[i]))}</span>
          </div>
        ))}
      </div>
      <div className="sbf-grid">
        <Text label="Saving Throws" value={sb.saves} onChange={(saves) => set({ saves })} placeholder="Dex +4, Wis +2" wide />
        <Text label="Skills" value={sb.skills} onChange={(skills) => set({ skills })} placeholder="Stealth +6" wide />
        <Text label="Damage Vulnerabilities" value={sb.vulnerabilities} onChange={(vulnerabilities) => set({ vulnerabilities })} wide />
        <Text label="Damage Resistances" value={sb.resistances} onChange={(resistances) => set({ resistances })} wide />
        <Text label="Damage Immunities" value={sb.immunities} onChange={(immunities) => set({ immunities })} wide />
        <Text label="Condition Immunities" value={sb.conditionImmunities} onChange={(conditionImmunities) => set({ conditionImmunities })} wide />
        <Text label="Senses" value={sb.senses} onChange={(senses) => set({ senses })} placeholder="darkvision 60 ft., passive Perception 9" wide />
        <Text label="Languages" value={sb.languages} onChange={(languages) => set({ languages })} wide />
        <label className="sbf-field">
          <span>Challenge</span>
          <select value={sb.cr} onChange={(e) => set({ cr: e.target.value })}>
            {(CRS.includes(sb.cr) ? CRS : [sb.cr, ...CRS]).map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <div className="sbf-field sbf-image">
          <span>Image (shown to players with “Show enemy”)</span>
          <div className="row">
            {imageUrl && <img src={imageUrl} alt="" />}
            <button onClick={() => void pickImage()}>{sb.image ? "Change…" : "Choose image…"}</button>
            {sb.image && (
              <button className="icon-btn danger-hover" onClick={() => set({ image: null })} title="Remove the image">
                ✕
              </button>
            )}
          </div>
        </div>
      </div>
      <EntryList title="Traits" list={sb.traits} onChange={(traits) => set({ traits })} addLabel="Trait" />
      <EntryList title="Actions" list={sb.actions} onChange={(actions) => set({ actions })} addLabel="Action" />
      <EntryList title="Bonus Actions" list={sb.bonusActions} onChange={(bonusActions) => set({ bonusActions })} addLabel="Bonus action" />
      <EntryList title="Reactions" list={sb.reactions} onChange={(reactions) => set({ reactions })} addLabel="Reaction" />
      <EntryList title="Legendary Actions" list={sb.legendaryActions} onChange={(legendaryActions) => set({ legendaryActions })} addLabel="Legendary action" />
      {sb.legendaryActions.length > 0 && (
        <label className="sbf-field wide">
          <span>Legendary actions intro</span>
          <textarea value={sb.legendaryIntro} rows={2} onChange={(e) => set({ legendaryIntro: e.target.value })} />
        </label>
      )}
    </div>
  );
}
