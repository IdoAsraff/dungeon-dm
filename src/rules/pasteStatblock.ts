/**
 * Best-effort reading of a stat block copied as text — from D&D Beyond
 * (labels and values often on separate lines) or from a book/PDF.
 */
import { emptyStatblock, type StatEntry, type Statblock } from "./statblock";

const SIZES = ["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"];

const LABELS: [RegExp, keyof Statblock | "challenge" | "ignore"][] = [
  [/^armor class\b/i, "ac"],
  [/^hit points\b/i, "hp"],
  [/^speed\b/i, "speed"],
  [/^saving throws\b/i, "saves"],
  [/^skills\b/i, "skills"],
  [/^damage vulnerabilities\b/i, "vulnerabilities"],
  [/^damage resistances\b/i, "resistances"],
  [/^damage immunities\b/i, "immunities"],
  [/^condition immunities\b/i, "conditionImmunities"],
  [/^senses\b/i, "senses"],
  [/^languages\b/i, "languages"],
  [/^challenge\b/i, "challenge"],
  [/^proficiency bonus\b/i, "ignore"],
];

const SECTION_TITLES: [RegExp, "traits" | "actions" | "bonusActions" | "reactions" | "legendaryActions"][] = [
  [/^actions$/i, "actions"],
  [/^bonus actions$/i, "bonusActions"],
  [/^reactions$/i, "reactions"],
  [/^legendary actions$/i, "legendaryActions"],
];

/** Lines after which the stat block is over (D&D Beyond page furniture). */
const STOP = /^(monster tags|environment|source|basic rules|view all|homebrew|compendium|tags:|habitat:|treasure:)/i;

const ABILITY_HEADER = /^(str|dex|con|int|wis|cha)$/i;
const SCORE = /(\d{1,2})\s*\(\s*[+\-−–]?\s*\d+\s*\)/g;

function labelOf(line: string): { key: (typeof LABELS)[number][1]; rest: string } | null {
  for (const [re, key] of LABELS) {
    const m = re.exec(line);
    if (m) return { key, rest: line.slice(m[0].length).trim() };
  }
  return null;
}

const ENTRY_RE = /^([A-Z][^.:]{0,70}?(?:\s*\([^)]*\))?)\.\s+(.+)$/;

export function parseStatblockText(raw: string): Statblock | null {
  const lines = raw
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (lines.length < 3) return null;
  const sb = emptyStatblock(lines[0]);
  sb.senses = "";
  sb.languages = "—";
  let i = 1;

  // Type line: "Small Humanoid (Goblinoid), Neutral Evil"
  const typeMatch = new RegExp(`^(${SIZES.join("|")})\\s+(.+?)(?:,\\s*(.+))?$`, "i").exec(lines[1]);
  if (typeMatch) {
    sb.size = typeMatch[1].charAt(0).toUpperCase() + typeMatch[1].slice(1).toLowerCase();
    sb.type = typeMatch[2].toLowerCase();
    sb.alignment = (typeMatch[3] ?? "").toLowerCase();
    i = 2;
  }

  // Properties up to the end of "Challenge" (or the first section).
  let scores: number[] = [];
  let sawChallenge = false;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (STOP.test(line)) break;
    if (SECTION_TITLES.some(([re]) => re.test(line))) break;
    if (ABILITY_HEADER.test(line) || /^str\s+dex\s+con/i.test(line)) continue;
    const found = [...line.matchAll(SCORE)].map((m) => Number(m[1]));
    if (found.length && scores.length < 6 && !labelOf(line)) {
      scores = scores.concat(found).slice(0, 6);
      continue;
    }
    const lab = labelOf(line);
    if (!lab) {
      if (sawChallenge) break; // first trait
      continue;
    }
    let value = lab.rest;
    if (!value && i + 1 < lines.length && !labelOf(lines[i + 1])) value = lines[++i];
    switch (lab.key) {
      case "ac": {
        const m = /^(\d+)\s*(?:\((.*)\))?/.exec(value);
        if (m) {
          sb.ac = Number(m[1]);
          sb.acNote = (m[2] ?? "").toLowerCase();
        }
        break;
      }
      case "hp": {
        const m = /^(\d+)\s*(?:\((.*)\))?/.exec(value);
        if (m) {
          sb.hp = Number(m[1]);
          sb.hitDice = (m[2] ?? "").replace(/\s*([+-])\s*/g, " $1 ").trim();
        }
        break;
      }
      case "challenge": {
        const m = /^(\d+(?:\/\d+)?)/.exec(value);
        if (m) sb.cr = m[1];
        sawChallenge = true;
        break;
      }
      case "ignore":
        break;
      default:
        (sb[lab.key] as string) = value.replace(/−/g, "-");
    }
  }
  if (scores.length === 6) sb.stats = scores as Statblock["stats"];

  // Traits and action sections.
  let section: "traits" | "actions" | "bonusActions" | "reactions" | "legendaryActions" = "traits";
  let current: StatEntry | null = null;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (STOP.test(line)) break;
    const title = SECTION_TITLES.find(([re]) => re.test(line));
    if (title) {
      section = title[1];
      current = null;
      continue;
    }
    const m = ENTRY_RE.exec(line);
    if (m && m[1].split(" ").length <= 8) {
      current = { name: m[1].trim(), desc: m[2].trim() };
      sb[section].push(current);
    } else if (section === "legendaryActions" && sb.legendaryActions.length === 0) {
      sb.legendaryIntro = sb.legendaryIntro ? `${sb.legendaryIntro} ${line}` : line;
    } else if (current) {
      current.desc += `\n${line}`;
    }
  }
  return sb;
}
