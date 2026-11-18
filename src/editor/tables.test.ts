import { describe, expect, it } from "vitest";
import { parseTable, splitRow } from "./tables";

describe("markdown tables", () => {
  it("splits rows, keeping pipes in links, code and escapes", () => {
    expect(splitRow("| a | b |")).toEqual(["a", "b"]);
    expect(splitRow("a | b")).toEqual(["a", "b"]);
    expect(splitRow("| [[Level 2#2-17C|2-17C]] | `x|y` | a \\| b |")).toEqual(["[[Level 2#2-17C|2-17C]]", "`x|y`", "a | b"]);
    expect(splitRow("| d10 | |")).toEqual(["d10", ""]);
  });

  it("parses header, alignment and rows, padding short rows", () => {
    const t = parseTable("| d10 | מפגש | הערה |\n| :---: | --- | ---: |\n| 1 | [[Gnoll|גנולים]] |\n| 2-3 | עטלפים | **שקט** |");
    expect(t).toEqual({
      header: ["d10", "מפגש", "הערה"],
      align: ["center", null, "right"],
      rows: [
        ["1", "[[Gnoll|גנולים]]", ""],
        ["2-3", "עטלפים", "**שקט**"],
      ],
    });
  });

  it("rejects text without a delimiter row", () => {
    expect(parseTable("| a | b |\n| c | d |")).toBeNull();
    expect(parseTable("| a |")).toBeNull();
  });
});
