#!/usr/bin/env node
// Initiative in the combat tracker: typing numbers (line boxes, Tab round the
// table, the add row, the inspector), the compact panel, ⏹ clearing it.
import { run, sleep, DM_CLIP, META } from "./lib.mjs";

const party = [
  { id: "pc-aria", name: "Aria", hp: 24, maxHp: 24, ac: 16, side: "party" },
  { id: "pc-bram", name: "Bram", hp: 31, maxHp: 31, ac: 18, side: "party" },
  { id: "pc-cass", name: "Cass", hp: 18, maxHp: 18, ac: 13, side: "party" },
];

/** Names in list order, with their initiative: "Aria 15". */
const ORDER = `return [...document.querySelectorAll(SCOPE + " .combat-row")].map(r => {
  const init = r.querySelector(".combat-init").value;
  return r.querySelector(".combat-name").value + (init ? " " + init : "");
})`;
const order = (h, scope = ".combat-view") => h.dm(`const SCOPE = ${JSON.stringify(scope)}; ${ORDER}`);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Clicks the initiative box of the line named `name`, then types each value with Tab between them. */
async function typeRound(h, name, values) {
  const id = await h.dm(`return [...document.querySelectorAll(".combat-view .combat-row")].find(r => r.querySelector(".combat-name").value === ${JSON.stringify(name)}).querySelector(".combat-init").dataset.init`);
  await h.click(`.combat-view .combat-init[data-init='${id}']`);
  for (let i = 0; i < values.length; i++) {
    await h.type(values[i]);
    await h.key(i === values.length - 1 ? "Enter" : "Tab");
    await sleep(100);
  }
  await sleep(150);
}

await run(
  async (h) => {
    await h.key("4", META);
    await h.waitFor(`const el = document.querySelector(".combat-view"); return !!el && el.offsetParent !== null`);
    h.check(!(await h.dm(`return /🎲/.test(document.querySelector(".combat-view").textContent)`)), "no dice button: the DM rolls");

    // Add row: Goblin x3 with SRD stats (no initiative), then an Ogre with 9.
    const addOne = async (name, stats, init) => {
      await h.click(".combat-view input.combat-add-name");
      await h.type(name);
      await h.key("Tab");
      await h.type(stats);
      await sleep(500);
      await h.key("Tab"); // picks the stat block, HP gets focus (pre-filled)
      await sleep(200);
      await h.key("Tab"); // → Init
      if (init) await h.type(init);
      await h.key("Enter");
      await sleep(300);
    };
    await addOne("Goblin x3", "Goblin");
    await addOne("Ogre", "Ogre", "9");
    let got = await order(h);
    h.check(same(got, ["Ogre 9", "Aria", "Bram", "Cass", "Goblin 1", "Goblin 2", "Goblin 3"]), `the add row's initiative puts the Ogre at the top (${got})`);

    // Round the table: Aria 15 ⇥ Bram 4 ⇥ Cass 12 ↵.
    await h.click(".combat-view .combat-init[data-init='pc-aria']");
    await h.type("15");
    await h.key("Tab");
    await sleep(100);
    h.check((await h.dm(`return document.activeElement?.dataset.init`)) === "pc-bram", "Tab goes to the next line's initiative box");
    await h.type("4");
    await h.key("Tab");
    await sleep(100);
    await h.type("12");
    await h.key("Enter");
    await sleep(200);
    got = await order(h);
    h.check(same(got, ["Aria 15", "Cass 12", "Ogre 9", "Bram 4", "Goblin 1", "Goblin 2", "Goblin 3"]), `typed initiatives sort the lines (${got})`);

    // The goblins all rolled 13: they stay together, in order.
    await typeRound(h, "Goblin 1", ["13", "13", "13"]);
    got = await order(h);
    h.check(same(got, ["Aria 15", "Goblin 1 13", "Goblin 2 13", "Goblin 3 13", "Cass 12", "Ogre 9", "Bram 4"]), `a group with the same number stays together (${got})`);
    await h.shot("init-typed", DM_CLIP);

    // Inspector: change Bram there; the line moves.
    await h.dm(`[...document.querySelectorAll(".combat-view .combat-row")].find(r => r.querySelector(".combat-name").value === "Bram").click(); return 1`);
    await h.waitFor(`return [...document.querySelectorAll(".insp-num span")].some(s => s.textContent === "Init")`);
    await h.dm(`const l = [...document.querySelectorAll(".insp-num")].find(l => l.querySelector("span").textContent === "Init"); l.querySelector("input").setAttribute("data-test", "insp-init"); return 1`);
    await h.click("[data-test='insp-init']");
    await h.type("20");
    await h.key("Enter");
    await sleep(200);
    h.check((await order(h))[0] === "Bram 20", `the inspector's Init box moves the line too (${(await order(h))[0]})`);

    // Start: the top line's turn.
    await h.click(".combat-view .turn-next");
    await sleep(200);
    h.check((await h.dm(`return document.querySelector(".combat-view .combat-row.turn .combat-name").value`)) === "Bram", "Start combat begins with the highest initiative");
    await h.shot("init-started", DM_CLIP);

    // Saved with the dungeon, never sent to the players.
    await sleep(700);
    const saved = await h.top(`const w = window.__saved.filter(s => s["dungeon.json"]).at(-1); return w ? JSON.parse(w["dungeon.json"]).session.combat.map(c => c.initiative) : null`);
    h.check(same(saved, [20, 15, 13, 13, 13, 12, 9]), `initiative is saved in dungeon.json (${JSON.stringify(saved)})`);
    h.check(!(await h.top(`return window.__playerData.some(p => p.includes("initiative"))`)), "nothing about initiative reaches the player window");

    // Compact panel on the Dungeon view.
    await h.key("1", META);
    await sleep(400);
    const compact = await order(h, ".dm-main");
    h.check(same(compact, ["Bram 20", "Aria 15", "Goblin 1 13", "Goblin 2 13", "Goblin 3 13", "Cass 12", "Ogre 9"]), `the compact panel shows the same order and numbers (${compact})`);
    const panel = await h.dm(`const r = document.querySelector(".dm-main .combat-panel").getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }`);
    await h.shot("init-compact", { x: panel.x - 4, y: panel.y - 4, width: panel.width + 8, height: panel.height + 8 });
    const rowHeights = await h.dm(`return [...document.querySelectorAll(".dm-main .combat-row")].map(r => Math.round(r.getBoundingClientRect().height))`);
    h.check(new Set(rowHeights).size === 1, `compact lines stay one row high (${rowHeights})`);

    // ⏹ End combat: numbers cleared, order kept.
    await h.key("4", META);
    await sleep(200);
    await h.click(".combat-view .turn-controls .icon-btn", "⏹");
    await sleep(200);
    got = await order(h);
    h.check(same(got, ["Bram", "Aria", "Goblin 1", "Goblin 2", "Goblin 3", "Cass", "Ogre"]), `⏹ clears initiative and keeps the order (${got})`);
  },
  {
    patch: (fx) => {
      const dj = JSON.parse(fx.dungeon["dungeon.json"]);
      dj.session.combat = party;
      fx.dungeon["dungeon.json"] = JSON.stringify(dj);
    },
  },
);
