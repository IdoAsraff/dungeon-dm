#!/usr/bin/env node
/**
 * Builds the bundled 5e (2014) rules data from two open sources:
 *
 *   5e-bits/5e-database  (SRD 5.1 as JSON; SRD content CC-BY-4.0, database MIT)
 *     https://github.com/5e-bits/5e-database
 *   crobi/dnd5e-quickref (combat quick reference; MIT; icons from game-icons.net, CC BY 3.0)
 *     https://github.com/crobi/dnd5e-quickref
 *
 * Usage:
 *   node scripts/build-rules-data.mjs <path to 5e-database checkout> <path to dnd5e-quickref checkout>
 *
 * Writes src/rules/data/{monsters,conditions,quickref}.json and the icons
 * used by them to public/rules-icons/ (resized with macOS `sips`).
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";

const [dbDir, qrDir] = process.argv.slice(2);
if (!dbDir || !qrDir) {
  console.error("usage: node scripts/build-rules-data.mjs <5e-database dir> <dnd5e-quickref dir>");
  process.exit(1);
}
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outData = path.join(root, "src/rules/data");
const outIcons = path.join(root, "public/rules-icons");
fs.mkdirSync(outData, { recursive: true });
fs.mkdirSync(outIcons, { recursive: true });

const srd = (name) => JSON.parse(fs.readFileSync(path.join(dbDir, "src/2014/en", name), "utf8"));

// ---- monsters ------------------------------------------------------------------------

const ABIL = { str: "Str", dex: "Dex", con: "Con", int: "Int", wis: "Wis", cha: "Cha" };
const sign = (n) => (n >= 0 ? `+${n}` : `${n}`);
const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

function crText(cr) {
  if (cr === 0.125) return "1/8";
  if (cr === 0.25) return "1/4";
  if (cr === 0.5) return "1/2";
  return String(cr);
}

function acNote(entry) {
  if (!entry) return "";
  switch (entry.type) {
    case "armor":
      return (entry.armor ?? []).map((a) => a.name.toLowerCase()).join(", ");
    case "natural":
      return "natural armor";
    case "spell":
      return entry.spell ? `with ${lowerFirst(entry.spell.name)}` : "";
    case "condition":
      return entry.condition ? `while ${lowerFirst(entry.condition.name)}` : "";
    default:
      return "";
  }
}

function speedText(speed) {
  const parts = [];
  for (const [k, v] of Object.entries(speed ?? {})) {
    if (k === "hover") continue;
    const text = k === "walk" ? v : `${k} ${v}`;
    parts.push(k === "fly" && speed.hover ? `${text} (hover)` : text);
  }
  return parts.join(", ");
}

function sensesText(senses) {
  const parts = [];
  for (const [k, v] of Object.entries(senses ?? {})) {
    if (k === "passive_perception") parts.push(`passive Perception ${v}`);
    else parts.push(`${k} ${v}`);
  }
  return parts.join(", ");
}

function usageSuffix(u) {
  if (!u) return "";
  if (u.type === "per day") return ` (${u.times}/Day${u.rest_types ? "" : ""})`;
  if (u.type === "recharge on roll") return u.min_value === 6 ? " (Recharge 6)" : ` (Recharge ${u.min_value}–6)`;
  if (u.type === "recharge after rest") {
    const rests = (u.rest_types ?? []).map((r) => r.charAt(0).toUpperCase() + r.slice(1));
    return ` (Recharges after a ${rests.join(" or ")} Rest)`;
  }
  return "";
}

function entries(list) {
  return (list ?? []).map((a) => ({ name: a.name + usageSuffix(a.usage), desc: a.desc ?? "" }));
}

function monster(m) {
  const saves = [];
  const skills = [];
  for (const p of m.proficiencies ?? []) {
    const n = p.proficiency?.name ?? "";
    let x = /^Saving Throw: (\w+)$/.exec(n);
    if (x) saves.push(`${ABIL[x[1].toLowerCase()] ?? x[1]} ${sign(p.value)}`);
    x = /^Skill: (.+)$/.exec(n);
    if (x) skills.push(`${x[1]} ${sign(p.value)}`);
  }
  const ac = m.armor_class?.[0];
  const type = m.subtype ? `${m.type} (${m.subtype})` : m.type;
  const legendary = entries(m.legendary_actions);
  const short = m.name.toLowerCase();
  return {
    id: m.index,
    name: m.name,
    size: m.size,
    type,
    alignment: m.alignment,
    ac: ac?.value ?? 10,
    acNote: acNote(ac),
    hp: m.hit_points,
    hitDice: (m.hit_points_roll ?? m.hit_dice ?? "").replace(/\+/g, " + ").replace(/-(\d)/g, " - $1"),
    speed: speedText(m.speed),
    stats: [m.strength, m.dexterity, m.constitution, m.intelligence, m.wisdom, m.charisma],
    saves: saves.join(", "),
    skills: skills.join(", "),
    vulnerabilities: (m.damage_vulnerabilities ?? []).join(", "),
    resistances: (m.damage_resistances ?? []).join(", "),
    immunities: (m.damage_immunities ?? []).join(", "),
    conditionImmunities: (m.condition_immunities ?? []).map((c) => c.name.toLowerCase()).join(", "),
    senses: sensesText(m.senses),
    languages: m.languages || "—",
    cr: crText(m.challenge_rating),
    traits: entries(m.special_abilities),
    actions: entries(m.actions),
    bonusActions: [],
    reactions: entries(m.reactions),
    legendaryActions: legendary,
    legendaryIntro: legendary.length
      ? `The ${short} can take 3 legendary actions, choosing from the options below. Only one legendary action option can be used at a time and only at the end of another creature's turn. The ${short} regains spent legendary actions at the start of its turn.`
      : "",
    description: "",
    image: null,
  };
}

const monsters = srd("5e-SRD-Monsters.json").map(monster).sort((a, b) => a.name.localeCompare(b.name));
fs.writeFileSync(path.join(outData, "monsters.json"), JSON.stringify(monsters));

// ---- conditions ------------------------------------------------------------------------

const conditions = srd("5e-SRD-Conditions.json").map((c) => ({
  id: c.index,
  name: c.name,
  desc: c.desc.join("\n"),
}));
fs.writeFileSync(path.join(outData, "conditions.json"), JSON.stringify(conditions, null, 1));

// ---- quick reference -------------------------------------------------------------------------

const sandbox = {};
vm.createContext(sandbox);
for (const f of fs.readdirSync(path.join(qrDir, "js")).filter((f) => f.startsWith("data_"))) {
  vm.runInContext(fs.readFileSync(path.join(qrDir, "js", f), "utf8").replace(/^(\s*)(data_\w+)\s*=/gm, "$1globalThis.$2 ="), sandbox);
}
const SECTIONS = [
  ["movement", "Movement", "data_movement"],
  ["action", "Actions", "data_action"],
  ["bonus", "Bonus actions", "data_bonusaction"],
  ["reaction", "Reactions", "data_reaction"],
  ["condition", "Conditions", "data_condition"],
  ["obscurance", "Obscurance", "data_environment_obscurance"],
  ["light", "Light", "data_environment_light"],
  ["vision", "Vision", "data_environment_vision"],
  ["cover", "Cover", "data_environment_cover"],
];
const icons = new Set();
const quickref = SECTIONS.map(([id, title, key]) => ({
  id,
  title,
  items: (sandbox[key] ?? []).map((it) => {
    if (it.icon) icons.add(it.icon);
    return {
      title: it.title,
      subtitle: it.subtitle ?? "",
      icon: it.icon ?? null,
      description: it.description ?? "",
      bullets: it.bullets ?? [],
      reference: it.reference ?? "",
    };
  }),
}));
fs.writeFileSync(path.join(outData, "quickref.json"), JSON.stringify(quickref, null, 1));

// ---- icons ---------------------------------------------------------------------------------

/** Icons for the conditions shown on combatant rows (distinct per condition). */
const CONDITION_ICONS = {
  blinded: "one-eyed",
  charmed: "smitten",
  deafened: "elf-ear",
  exhaustion: "sleepy",
  frightened: "terror",
  grappled: "grab",
  incapacitated: "internal-injury",
  invisible: "invisible",
  paralyzed: "frozen-block",
  petrified: "stone-pile",
  poisoned: "poison-bottle",
  prone: "crawl",
  restrained: "manacles",
  stunned: "brain-freeze",
  unconscious: "coma",
  concentrating: "concentration-orb",
};
for (const i of Object.values(CONDITION_ICONS)) icons.add(i);
for (const f of fs.readdirSync(outIcons)) fs.rmSync(path.join(outIcons, f));
for (const icon of icons) {
  const src = path.join(qrDir, "img", `${icon}.png`);
  if (!fs.existsSync(src)) {
    console.warn("missing icon", icon);
    continue;
  }
  execFileSync("sips", ["-Z", "96", src, "--out", path.join(outIcons, `${icon}.png`)], { stdio: "ignore" });
}
fs.writeFileSync(path.join(outData, "conditionIcons.json"), JSON.stringify(CONDITION_ICONS, null, 1));

console.log(`${monsters.length} monsters, ${conditions.length} conditions, ${quickref.reduce((n, s) => n + s.items.length, 0)} quickref items, ${icons.size} icons`);
