/** Read-only views of stat blocks and SRD documents. */
import { Fragment, type ReactNode } from "react";
import { ABILITIES, abilityMod, crXp, formatMod, proficiencyBonus, typeLine, type StatEntry, type Statblock } from "./statblock";
import { CONDITION_ICONS, SRD_CREDIT, iconUrl, splitSrdId, srdCondition, srdMonster } from "./srd";
import { copyToCustomStatblock } from "./statNotes";

/** Minimal inline markdown for stat block text: **bold**, *italic*, _italic_. */
export function InlineText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_)/g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) parts.push(text.slice(last, m.index));
    const t = m[0];
    parts.push(t.startsWith("**") ? <b key={i++}>{t.slice(2, -2)}</b> : <i key={i++}>{t.slice(1, -1)}</i>);
    last = m.index! + t.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

/** "Melee Weapon Attack:" and "Hit:" are italic, like in the books. */
const LEAD_RE = /((?:Melee or Ranged|Melee|Ranged) (?:Weapon|Spell) Attack:|Hit:)/;

function EntryDesc({ desc }: { desc: string }) {
  return (
    <>
      {desc.split("\n").map((line, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {line.split(LEAD_RE).map((part, j) => (LEAD_RE.test(part) ? <i key={j}>{part}</i> : <InlineText key={j} text={part} />))}
        </Fragment>
      ))}
    </>
  );
}

function Entries({ title, list, intro }: { title?: string; list: StatEntry[]; intro?: string }) {
  if (!list.length) return null;
  return (
    <div className="sb-section">
      {title && <h3 className="sb-section-title">{title}</h3>}
      {intro && <p className="sb-entry">{intro}</p>}
      {list.map((e, i) => (
        <p key={i} className="sb-entry" dir="auto">
          <b>
            <i>{e.name}.</i>
          </b>{" "}
          <EntryDesc desc={e.desc} />
        </p>
      ))}
    </div>
  );
}

function Prop({ label, value }: { label: string; value: string | number }) {
  if (value === "" || value === null || value === undefined) return null;
  return (
    <div className="sb-prop">
      <b>{label}</b> <span dir="auto">{value}</span>
    </div>
  );
}

/**
 * A creature's stat block in the familiar layout. `header` adds buttons next
 * to the name; `below` goes after the stat block (e.g. the description).
 */
export function StatblockView({ sb, imageUrl, header, below }: { sb: Statblock; imageUrl?: string | null; header?: ReactNode; below?: ReactNode }) {
  const xp = crXp(sb.cr);
  return (
    <div className="statblock">
      <div className="sb-head">
        <div className="grow">
          <h2 className="sb-name" dir="auto">
            {sb.name}
          </h2>
          <div className="sb-type" dir="auto">
            {typeLine(sb)}
          </div>
        </div>
        {header && <div className="sb-head-actions">{header}</div>}
      </div>
      {imageUrl && <img className="sb-image" src={imageUrl} alt="" draggable={false} />}
      <div className="sb-rule" />
      <Prop label="Armor Class" value={sb.acNote ? `${sb.ac} (${sb.acNote})` : sb.ac} />
      <Prop label="Hit Points" value={sb.hitDice ? `${sb.hp} (${sb.hitDice})` : sb.hp} />
      <Prop label="Speed" value={sb.speed} />
      <div className="sb-rule" />
      <div className="sb-abilities">
        {ABILITIES.map((a, i) => (
          <div key={a}>
            <b>{a}</b>
            <span>
              {sb.stats[i]} ({formatMod(abilityMod(sb.stats[i]))})
            </span>
          </div>
        ))}
      </div>
      <div className="sb-rule" />
      <Prop label="Saving Throws" value={sb.saves} />
      <Prop label="Skills" value={sb.skills} />
      <Prop label="Damage Vulnerabilities" value={sb.vulnerabilities} />
      <Prop label="Damage Resistances" value={sb.resistances} />
      <Prop label="Damage Immunities" value={sb.immunities} />
      <Prop label="Condition Immunities" value={sb.conditionImmunities} />
      <Prop label="Senses" value={sb.senses} />
      <Prop label="Languages" value={sb.languages} />
      <div className="sb-prop sb-cr">
        <span>
          <b>Challenge</b> {sb.cr}
          {xp !== null ? ` (${xp.toLocaleString("en-US")} XP)` : ""}
        </span>
        <span>
          <b>Proficiency Bonus</b> {formatMod(proficiencyBonus(sb.cr))}
        </span>
      </div>
      {(sb.traits.length > 0 || sb.actions.length > 0) && <div className="sb-rule" />}
      <Entries list={sb.traits} />
      <Entries title="Actions" list={sb.actions} />
      <Entries title="Bonus Actions" list={sb.bonusActions} />
      <Entries title="Reactions" list={sb.reactions} />
      <Entries title="Legendary Actions" list={sb.legendaryActions} intro={sb.legendaryIntro} />
      {below}
    </div>
  );
}

/** Text of a condition with its icon. */
export function ConditionView({ id, extra }: { id: string; extra?: ReactNode }) {
  const c = srdCondition(id);
  if (!c) return <div className="note-missing">Unknown condition.</div>;
  const icon = CONDITION_ICONS[c.id];
  return (
    <div className="condition-view">
      <div className="condition-head">
        {icon && <img className="rules-icon big" src={iconUrl(icon)} alt="" />}
        <h2>{c.name}</h2>
      </div>
      <ConditionText desc={c.desc} />
      {extra}
    </div>
  );
}

export function ConditionText({ desc }: { desc: string }) {
  const lines = desc.split("\n");
  return (
    <div className="condition-text">
      {lines.map((l, i) =>
        l.startsWith("- ") ? (
          <li key={i}>
            <InlineText text={l.slice(2)} />
          </li>
        ) : (
          <p key={i}>
            <InlineText text={l} />
          </p>
        ),
      )}
    </div>
  );
}

/** An SRD document opened in Notes (read-only). */
export function SrdDocView({ id }: { id: string }) {
  const [kind, key] = splitSrdId(id);
  const credit = <p className="hint srd-credit">{SRD_CREDIT}</p>;
  if (kind === "condition") return <ConditionView id={key} extra={credit} />;
  const m = srdMonster(key);
  if (!m) return <div className="note-missing">Not found in the SRD.</div>;
  return (
    <div className="srd-doc">
      <StatblockView
        sb={m}
        header={
          <button onClick={() => void copyToCustomStatblock(m)} title="Create an editable stat block note from this one">
            Make a custom copy
          </button>
        }
        below={credit}
      />
    </div>
  );
}
