/**
 * 5e (2014) creature stat blocks: one shape for the bundled SRD monsters and
 * for the DM's own stat block notes.
 *
 * A stat block note is a normal markdown note that starts with a fenced
 * ```statblock block of YAML (the format of Obsidian's Fantasy Statblocks
 * plugin), followed by free-text description.
 */
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export interface StatEntry {
  name: string;
  desc: string;
}

export interface Statblock {
  name: string;
  size: string;
  /** Creature type with optional tag, e.g. "humanoid (goblinoid)". */
  type: string;
  alignment: string;
  ac: number;
  /** e.g. "leather armor, shield" */
  acNote: string;
  hp: number;
  /** e.g. "2d6" or "19d12 + 133" */
  hitDice: string;
  speed: string;
  /** STR, DEX, CON, INT, WIS, CHA */
  stats: [number, number, number, number, number, number];
  /** e.g. "Dex +6, Con +13" */
  saves: string;
  /** e.g. "Perception +13, Stealth +6" */
  skills: string;
  vulnerabilities: string;
  resistances: string;
  immunities: string;
  conditionImmunities: string;
  senses: string;
  languages: string;
  /** "1/4", "10" ... */
  cr: string;
  traits: StatEntry[];
  actions: StatEntry[];
  bonusActions: StatEntry[];
  reactions: StatEntry[];
  legendaryActions: StatEntry[];
  legendaryIntro: string;
  /** Free text (markdown). For notes this is the text after the block. */
  description: string;
  /** Image: an attachment name like "goblin.png" (notes) — none for SRD. */
  image: string | null;
}

export const ABILITIES = ["STR", "DEX", "CON", "INT", "WIS", "CHA"] as const;
const SAVE_KEYS = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"];
const SAVE_SHORT = ["Str", "Dex", "Con", "Int", "Wis", "Cha"];

export function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function formatMod(n: number): string {
  return n >= 0 ? `+${n}` : `−${Math.abs(n)}`;
}

const XP_BY_CR: Record<string, number> = {
  "0": 10, "1/8": 25, "1/4": 50, "1/2": 100, "1": 200, "2": 450, "3": 700, "4": 1100, "5": 1800, "6": 2300, "7": 2900,
  "8": 3900, "9": 5000, "10": 5900, "11": 7200, "12": 8400, "13": 10000, "14": 11500, "15": 13000, "16": 15000,
  "17": 18000, "18": 20000, "19": 22000, "20": 25000, "21": 33000, "22": 41000, "23": 50000, "24": 62000, "25": 75000,
  "26": 90000, "27": 105000, "28": 120000, "29": 135000, "30": 155000,
};

export function crXp(cr: string): number | null {
  return XP_BY_CR[cr.trim()] ?? null;
}

export function crValue(cr: string): number {
  const m = /^(\d+)\/(\d+)$/.exec(cr.trim());
  if (m) return Number(m[1]) / Number(m[2]);
  const n = Number(cr);
  return Number.isFinite(n) ? n : 0;
}

export function proficiencyBonus(cr: string): number {
  return 2 + Math.floor(Math.max(0, crValue(cr) - 1) / 4);
}

export function emptyStatblock(name = "New creature"): Statblock {
  return {
    name,
    size: "Medium",
    type: "humanoid",
    alignment: "unaligned",
    ac: 10,
    acNote: "",
    hp: 1,
    hitDice: "",
    speed: "30 ft.",
    stats: [10, 10, 10, 10, 10, 10],
    saves: "",
    skills: "",
    vulnerabilities: "",
    resistances: "",
    immunities: "",
    conditionImmunities: "",
    senses: "passive Perception 10",
    languages: "—",
    cr: "0",
    traits: [],
    actions: [],
    bonusActions: [],
    reactions: [],
    legendaryActions: [],
    legendaryIntro: "",
    description: "",
    image: null,
  };
}

/** "Small humanoid (goblinoid), neutral evil" */
export function typeLine(s: Statblock): string {
  const t = [s.size, s.type].filter(Boolean).join(" ");
  return [t, s.alignment].filter(Boolean).join(", ");
}

// ---- note format --------------------------------------------------------------------------

const BLOCK_RE = /^\s*```statblock[^\n]*\n([\s\S]*?)\n```[ \t]*(?:\n|$)/;

export function isStatblockNote(text: string): boolean {
  return BLOCK_RE.test(text);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v));
const num = (v: unknown, fallback: number): number => {
  const m = /-?\d+/.exec(str(v));
  return m ? Number(m[0]) : fallback;
};

function entryList(v: unknown): StatEntry[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((e) => e && typeof e === "object")
    .map((e: any) => ({ name: str(e.name), desc: str(e.desc ?? e.description) }));
}

const titleCase = (s: string) =>
  s
    .split(/\s+/)
    .map((w, i) => (i > 0 && ["of", "and", "the"].includes(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");

/** `saves: [{dexterity: 4}]` or "Dex +4, Con +2" → "Dex +4, Con +2" */
function listToText(v: unknown, keys?: string[], short?: string[]): string {
  if (typeof v === "string") return v;
  if (!Array.isArray(v)) return "";
  const parts: string[] = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    for (const [k, val] of Object.entries(item)) {
      const i = keys ? keys.indexOf(k.toLowerCase()) : -1;
      const label = i >= 0 && short ? short[i] : titleCase(k);
      const n = Number(val);
      parts.push(`${label} ${Number.isFinite(n) ? formatMod(n).replace("−", "-") : val}`);
    }
  }
  return parts.join(", ");
}

/** "Dex +4, Sleight of Hand +6" → [{dexterity: 4}, ...] (Fantasy Statblocks style) */
function textToList(text: string, keys?: string[], short?: string[]): Record<string, number>[] | string {
  const parts = text
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const out: Record<string, number>[] = [];
  for (const p of parts) {
    const m = /^(.+?)\s*([+-−]\s*\d+)$/.exec(p);
    if (!m) return text; // keep free text as is
    const label = m[1].trim();
    const i = short ? short.findIndex((s) => s.toLowerCase() === label.toLowerCase().slice(0, 3)) : -1;
    const key = keys && i >= 0 && label.length <= 12 && keys[i].startsWith(label.toLowerCase().slice(0, 3)) ? keys[i] : label.toLowerCase();
    out.push({ [key]: Number(m[2].replace(/\s/g, "").replace("−", "-")) });
  }
  return out;
}

function imageName(v: unknown): string | null {
  const s = str(v).trim();
  if (!s) return null;
  return s.replace(/^!?\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim() || null;
}

/** Reads the YAML of a statblock block. Throws on malformed YAML. */
export function statblockFromYaml(yamlText: string): Statblock {
  const y = (parseYaml(yamlText) ?? {}) as Record<string, any>;
  const base = emptyStatblock("Unnamed");
  // Defaults only for missing keys: an emptied field stays empty while editing.
  const has = (k: string) => y[k] !== undefined && y[k] !== null;
  const acRaw = str(y.ac);
  const acNoteMatch = /\(([^)]*)\)/.exec(acRaw);
  const type = [str(y.type), y.subtype ? `(${str(y.subtype)})` : ""].filter(Boolean).join(" ");
  const stats = Array.isArray(y.stats) && y.stats.length === 6 ? (y.stats.map((n: unknown) => num(n, 10)) as Statblock["stats"]) : base.stats;
  return {
    ...base,
    name: has("name") ? str(y.name) : base.name,
    size: has("size") ? str(y.size) : base.size,
    type: has("type") || has("subtype") ? type : base.type,
    alignment: has("alignment") ? str(y.alignment) : base.alignment,
    ac: num(acRaw, base.ac),
    acNote: str(y.ac_note) || (acNoteMatch ? acNoteMatch[1] : ""),
    hp: num(y.hp, base.hp),
    hitDice: str(y.hit_dice),
    speed: has("speed") ? str(y.speed) : base.speed,
    stats,
    saves: listToText(y.saves, SAVE_KEYS, SAVE_SHORT),
    skills: listToText(y.skillsaves ?? y.skills),
    vulnerabilities: str(y.damage_vulnerabilities),
    resistances: str(y.damage_resistances),
    immunities: str(y.damage_immunities),
    conditionImmunities: str(y.condition_immunities),
    senses: str(y.senses),
    languages: has("languages") ? str(y.languages) : "—",
    cr: str(y.cr) || "0",
    traits: entryList(y.traits),
    actions: entryList(y.actions),
    bonusActions: entryList(y.bonus_actions),
    reactions: entryList(y.reactions),
    legendaryActions: entryList(y.legendary_actions),
    legendaryIntro: str(y.legendary_description),
    image: imageName(y.image),
  };
}

export function statblockToYaml(s: Statblock): string {
  const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(s.type);
  const out: Record<string, unknown> = {
    name: s.name,
    size: s.size,
    type: m ? m[1] : s.type,
  };
  if (m) out.subtype = m[2];
  out.alignment = s.alignment;
  out.ac = s.ac;
  if (s.acNote) out.ac_note = s.acNote;
  out.hp = s.hp;
  if (s.hitDice) out.hit_dice = s.hitDice;
  out.speed = s.speed;
  out.stats = s.stats;
  if (s.saves.trim()) out.saves = textToList(s.saves, SAVE_KEYS, SAVE_SHORT);
  if (s.skills.trim()) out.skillsaves = textToList(s.skills);
  if (s.vulnerabilities) out.damage_vulnerabilities = s.vulnerabilities;
  if (s.resistances) out.damage_resistances = s.resistances;
  if (s.immunities) out.damage_immunities = s.immunities;
  if (s.conditionImmunities) out.condition_immunities = s.conditionImmunities;
  if (s.senses) out.senses = s.senses;
  out.languages = s.languages;
  out.cr = s.cr;
  const list = (l: StatEntry[]) => l.map((e) => ({ name: e.name, desc: e.desc }));
  if (s.traits.length) out.traits = list(s.traits);
  if (s.actions.length) out.actions = list(s.actions);
  if (s.bonusActions.length) out.bonus_actions = list(s.bonusActions);
  if (s.reactions.length) out.reactions = list(s.reactions);
  if (s.legendaryActions.length) out.legendary_actions = list(s.legendaryActions);
  if (s.legendaryIntro) out.legendary_description = s.legendaryIntro;
  if (s.image) out.image = `[[${s.image}]]`;
  return stringifyYaml(out, { lineWidth: 0 }).trimEnd();
}

export interface ParsedStatNote {
  statblock: Statblock | null;
  /** Error message when the block exists but can't be read. */
  error: string | null;
  /** The note text after the block (the description). */
  body: string;
}

export function parseStatNote(text: string): ParsedStatNote {
  const m = BLOCK_RE.exec(text);
  if (!m) return { statblock: null, error: null, body: text };
  const body = text.slice(m[0].length).replace(/^\n/, "");
  try {
    const sb = statblockFromYaml(m[1]);
    return { statblock: { ...sb, description: body }, error: null, body };
  } catch (e) {
    return { statblock: null, error: e instanceof Error ? e.message : String(e), body };
  }
}

export function composeStatNote(s: Statblock, body: string): string {
  return "```statblock\n" + statblockToYaml(s) + "\n```\n" + (body ? "\n" + body : "");
}

/** Replaces the stat block of a note, keeping its description text as is. */
export function replaceStatNoteBlock(text: string, s: Statblock): string {
  const m = BLOCK_RE.exec(text);
  const body = m ? text.slice(m[0].length).replace(/^\n/, "") : text;
  return composeStatNote(s, body);
}

/** Replaces the description of a stat block note, keeping the block's YAML untouched. */
export function replaceStatNoteBody(text: string, body: string): string {
  const m = BLOCK_RE.exec(text);
  if (!m) return body;
  const block = m[0].endsWith("\n") ? m[0] : m[0] + "\n";
  return block + (body ? "\n" + body : "");
}

/** Text of a new stat block note. */
export function newStatNote(s: Statblock = emptyStatblock()): string {
  return composeStatNote(s, s.description);
}
