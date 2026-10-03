#!/usr/bin/env node
/**
 * Builds the e2e fixture dungeon in tools/e2e/fx/ from examples/sample-dungeon:
 * the files on disk (images are served by Vite from there) and fx/files.json,
 * which the mocked backend loads.
 *
 *   node tools/e2e/fixture.mjs              # the committed sample (git HEAD)
 *   node tools/e2e/fixture.mjs --worktree   # the sample as it is on disk now
 *
 * Drivers can then change fx/files.json (e.g. add notes or combatants) before
 * loading the page: see the `patch` option of startHarness() in lib.mjs.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const SAMPLE = "examples/sample-dungeon";
const FX = path.join(here, "fx");
const fromWorktree = process.argv.includes("--worktree");

const git = (...a) => execFileSync("git", a, { cwd: root, maxBuffer: 64 << 20 });
const list = fromWorktree
  ? (function walk(d) {
      return fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) =>
        e.name === ".dungeon-dm" || e.name === ".trash" ? [] : e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`],
      );
    })(SAMPLE)
  : git("ls-files", SAMPLE).toString().trim().split("\n");

fs.rmSync(FX, { recursive: true, force: true });
const out = { dungeon: {}, notes: {}, attachments: [] };
for (const file of list) {
  const rel = path.relative(SAMPLE, file);
  const data = fromWorktree ? fs.readFileSync(path.join(root, file)) : git("show", `HEAD:${file}`);
  fs.mkdirSync(path.dirname(path.join(FX, rel)), { recursive: true });
  fs.writeFileSync(path.join(FX, rel), data);
  if (rel.startsWith("notes/")) {
    const n = rel.slice(6);
    if (n.endsWith(".md")) out.notes[n] = data.toString();
    else out.attachments.push(n);
  } else if (/\.(json|md)$/.test(rel)) out.dungeon[rel] = data.toString();
}
fs.writeFileSync(path.join(FX, "files.json"), JSON.stringify(out));
console.log(`fixture: ${Object.keys(out.dungeon).length} dungeon files, ${Object.keys(out.notes).length} notes, ${out.attachments.length} attachments (${fromWorktree ? "worktree" : "HEAD"})`);
