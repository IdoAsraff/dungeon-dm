import { describe, expect, it } from "vitest";
import { LinkIndex, formatWikiLink, parseWikiLinks, rewriteLinks, safeFileName, splitLinkInner, validateName } from "./wikiLinks";

describe("wiki links", () => {
  it("parses targets, headings, aliases and embeds", () => {
    const text = "See [[Belak]], [[NPCs/Belak#Spells|his spells]] and ![[map.png|300]]. Not [this](x).";
    const links = parseWikiLinks(text);
    expect(links.map((l) => [l.embed, l.target, l.heading, l.alias])).toEqual([
      [false, "Belak", null, null],
      [false, "NPCs/Belak", "Spells", "his spells"],
      [true, "map.png", null, "300"],
    ]);
    expect(text.slice(links[1].from, links[1].to)).toBe("[[NPCs/Belak#Spells|his spells]]");
    expect(text.slice(links[2].from, links[2].to)).toBe("![[map.png|300]]");
  });

  it("round-trips formatting", () => {
    for (const s of ["[[A]]", "[[A#h]]", "[[A|b]]", "[[f/A#h|b]]", "![[x.png]]"]) {
      const [l] = parseWikiLinks(s);
      expect(formatWikiLink(l)).toBe(s);
    }
    expect(splitLinkInner("Grove Level#42")).toEqual({ target: "Grove Level", heading: "42", alias: null });
  });

  it("resolves like Obsidian: exact path, then shortest path by name", () => {
    const idx = new LinkIndex([
      { id: "note:NPCs/Belak.md", path: "NPCs/Belak" },
      { id: "note:Old/Deep/Belak.md", path: "Old/Deep/Belak" },
      { id: "note:הגן.md", path: "הגן" },
      { id: "level:l1", path: "levels/Grove Level" },
    ]);
    expect(idx.resolve("Belak")?.id).toBe("note:NPCs/Belak.md");
    expect(idx.resolve("old/deep/belak.md")?.id).toBe("note:Old/Deep/Belak.md");
    expect(idx.resolve("הגן")?.id).toBe("note:הגן.md");
    expect(idx.resolve("grove level")?.id).toBe("level:l1");
    expect(idx.resolve("Nope")).toBeNull();
    expect(idx.linkTextFor(idx.targets[0])).toBe("Belak");
    expect(idx.linkTextFor(idx.targets[1])).toBe("Old/Deep/Belak");
  });

  it("rewrites only links to the renamed note", () => {
    const idx = new LinkIndex([
      { id: "a", path: "Belak" },
      { id: "b", path: "Sharwyn" },
    ]);
    const text = "[[Belak]] met [[Sharwyn]]; see [[Belak#AC|his AC]] and ![[belak]].";
    expect(rewriteLinks(text, idx, "a", "Belak the Outcast")).toBe(
      "[[Belak the Outcast]] met [[Sharwyn]]; see [[Belak the Outcast#AC|his AC]] and ![[Belak the Outcast]].",
    );
    const same = "nothing here";
    expect(rewriteLinks(same, idx, "a", "x")).toBe(same);
  });

  it("validates names and makes safe file names", () => {
    expect(validateName("Belak")).toBeNull();
    expect(validateName("בלאק המנודה")).toBeNull();
    expect(validateName("")).not.toBeNull();
    expect(validateName("a/b")).not.toBeNull();
    expect(validateName(".hidden")).not.toBeNull();
    expect(safeFileName("Level 1: The Crypt?")).toBe("Level 1- The Crypt-");
    expect(safeFileName("")).toBe("Untitled");
  });
});
