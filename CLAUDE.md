# Dungeon DM — notes for Claude

A desktop tool (Tauri 2 + React 19 + TypeScript) that one DM uses to run in-person D&D 5e
(2014) sessions: a **DM window** (map, notes, music, combat) and a **player window** on a TV
that shows only what the players know. The user is the DM and the only user; they test by
opening `examples/sample-dungeon` (or their own dungeons) in the built app.

- **What the app does, for users:** `README.md` (keep it up to date: every user-visible change
  gets a line there).
- **How the code works:** `docs/architecture.md`. Read it before changing anything.
- **Step-by-step checklists** for common changes (new saved field, new view, new backend
  command, shortcuts, panels...): `docs/recipes.md`.
- **Testing**, including the browser harness that drives the real UI: `docs/testing.md`.

## Commands

```sh
npm test               # vitest unit tests (src/**/*.test.ts)
npm run typecheck      # tsc
npm run test:rust      # backend tests (cargo; needs the sandbox off)
npm run app:build      # builds src-tauri/target/release/bundle/macos/Dungeon DM.app (sandbox off)
node tools/e2e/fixture.mjs && node tools/e2e/smoke.mjs   # browser smoke test (see docs/testing.md)
```

Rust is installed in `~/.cargo`; the npm scripts add it to PATH themselves.

## Definition of done

1. `npm run typecheck` and `npm test` pass; `npm run test:rust` too if `src-tauri` changed.
2. New logic has unit tests; UI changes are checked with an e2e driver and screenshots you
   actually look at (copy `tools/e2e/smoke.mjs`). Delete throwaway drivers afterwards, or keep
   them in `tools/e2e/` if they are worth re-running.
3. `README.md` describes the feature (and the file format section if `dungeon.json` or the
   folder layout changed). If you changed how something works internally or added a pattern
   others should follow, update `docs/` (and this file) in the same commit.
4. Committed (when the user asked for it), then `npm run app:build` so the user can try it.
   Tell the user how to use the feature in a few short bullets.

## Rules

- **Secrets:** the Spotify Client ID and tokens live only in the Mac's app settings (typed on
  the Connect screen). Never put them in code, tests, fixtures, the repo or a dungeon folder.
- **Never `git add -A` / `git add .`.** The user play-tests `examples/sample-dungeon` in the
  app, which leaves uncommitted changes there (and `notes/.trash`, `Stats/`...). Stage explicit
  paths, and don't commit or revert their sample-dungeon edits unless asked.
- **Commits:** one commit per feature, message = a plain sentence of what changed for the user
  (see `git log`), ending with the `Co-Authored-By` line. Work on `main`. Don't push to
  `origin` (GitHub) unless the user asks; pushing needs their SSH key, so it may have to be done by them.
- **Toolbar:** the DM toolbar must stay one row at a 1400px wide window (it has ~13px to spare
  with the music mini-player). Put new controls in the panel they belong to, not the toolbar.
- **Data compatibility:** dungeons are user data. New fields must be optional when parsing
  (old files keep opening), and parsing must clamp/ignore bad values rather than fail.
- **Players never see DM information:** only what `buildPlayerData` sends reaches the player
  window. Never send descriptions, notes, doors, objects, stats or unrevealed rooms.
- Ask before adding npm/cargo dependencies (network access is limited; the user prefers few).

## The user's preferences

- Wants features that help *run in-person sessions* quickly; prefers clicks and short
  keyboard paths over configuration.
- Writes notes partly in Hebrew: any text field must handle RTL (`dir="auto"`).
- Suggested and **rejected** (don't propose again): music hotkeys, automatic music triggers
  (e.g. music changing when a room is revealed), lowering music during read-aloud,
  auto-pinning playlists by name prefix, the app rolling dice (e.g. initiative for enemies:
  the DM rolls real dice and types the results). Local sound files: "later".
- D&D content: only the free SRD 5.1 (2014) is bundled (CC-BY-4.0, credited in the README);
  everything else comes from stat blocks the user pastes. Don't scrape D&D Beyond or 5etools.

## Sandbox notes (Claude Code)

- Needs `dangerouslyDisableSandbox: true`: git commands that write `.git/`, `cargo`
  (`test:rust`, `app:build`), the Vite dev server and Chrome for e2e, and
  `scripts/build-rules-data.mjs` (uses `sips`).
- `npm install` needs network access to `registry.npmjs.org`.
- `open` (launching the app) is blocked in the sandbox; ask the user to run it.
- Vite's file watcher may miss edits made inside the sandbox: restart Vite if the page is stale.
