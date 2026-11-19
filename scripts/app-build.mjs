#!/usr/bin/env node
/**
 * `npm run app:build`: a release build for this machine.
 *
 * - macOS: the app bundle, src-tauri/target/release/bundle/macos/Dungeon DM.app
 * - Linux: the program itself, src-tauri/target/release/dungeon-dm (no installer, so no
 *   extra packaging tools are needed; run it directly). For an installer, pass the bundle
 *   yourself: `npm run app:build -- --bundles deb` (or appimage, rpm).
 *
 * Extra arguments are passed on to `tauri build`. Rust from ~/.cargo/bin is put on the PATH.
 */
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const extra = process.argv.slice(2);
const platformArgs = extra.some((a) => a === "--bundles" || a === "-b" || a.startsWith("--bundles=") || a === "--no-bundle")
  ? []
  : process.platform === "darwin"
    ? ["--bundles", "app"]
    : ["--no-bundle"];
const env = { ...process.env, PATH: [path.join(os.homedir(), ".cargo", "bin"), process.env.PATH].join(path.delimiter) };
const result = spawnSync("tauri", ["build", ...platformArgs, ...extra], { stdio: "inherit", env, shell: process.platform === "win32" });
if (result.status === 0 && process.platform === "linux" && platformArgs.includes("--no-bundle")) {
  console.log(`\nBuilt ${path.join("src-tauri", "target", "release", "dungeon-dm")}: run it directly to start Dungeon DM.`);
}
process.exit(result.status ?? 1);
