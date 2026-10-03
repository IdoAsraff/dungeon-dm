#!/usr/bin/env node
// Smoke test: open the sample dungeon, check every view and the player window.
// Copy this file as a starting point for a feature's own driver.
import { run, DM_CLIP, PLAYER_CLIP, META } from "./lib.mjs";

await run(async (h) => {
  h.check(await h.dm(`return !!document.querySelector(".dm-map-area canvas")`), "the DM map renders");
  h.check(await h.waitFor(`return !!document.querySelector(".player-root canvas")`, 4000, "player"), "the player window renders the map");
  const known = await h.top(`return JSON.parse(window.__playerData.at(-1)).levels[0]?.rooms.length ?? 0`);
  h.check(known >= 1, `the player window got the revealed room(s) (${known})`);

  for (const [n, sel, name] of [["2", ".notes-main", "Notes"], ["3", ".music-host", "Music"], ["4", ".combat-view", "Combat"], ["1", ".dm-main", "Dungeon"]]) {
    await h.key(n, META);
    h.check(await h.waitFor(`const el = document.querySelector(${JSON.stringify(sel)}); return !!el && el.offsetParent !== null`), `⌘${n} shows ${name}`);
  }

  // Select the first room in the side panel's list: the room panel opens.
  await h.click(".side-panel .entity-list button");
  h.check(await h.waitFor(`return /Conceal|Reveal/.test(document.querySelector(".side-panel").textContent)`), "clicking a room opens its panel");
  await h.shot("smoke-dm", DM_CLIP);
  await h.shot("smoke-player", PLAYER_CLIP);
});
