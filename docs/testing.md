# Testing

Three layers. Use all that apply before calling a change done.

## 1. Unit tests (vitest)

```sh
npm test                       # all
npx vitest run src/lib/serialize.test.ts   # one file
```

- Files: `src/**/*.test.ts`, run in Node (no DOM). Test pure logic and stores, not components.
- Stores can be driven directly: `useDoc.getState().addRoom(...)`, `useSession.setState(...)`.
- Modules that call the backend: mock it, like
  `vi.mock("../lib/backend", () => ({ backend: { updateSettings: async () => {}, getSettings: async () => ({}) } }))`
  (see `src/spotify/music.test.ts`).
- Spotify: `createFakeSpotify(...)` from `src/spotify/fakeSpotify.ts`, installed as
  `globalThis.__spotifyFetch`. Its `log` records every request.
- `src/lib/examples.test.ts` checks the **committed** `examples/sample-dungeon` still parses.
  It reads it from git HEAD on purpose, so the user's uncommitted play-test edits don't matter.

## 2. Backend tests (cargo)

```sh
npm run test:rust      # sandbox off
```

Tests are at the bottom of `src-tauri/src/lib.rs`.

## 3. E2E: the real UI in headless Chrome

`tools/e2e/` runs the real app (`src/main.tsx`) in a browser page with **two iframes, the DM
window and the player window**, and a mocked Tauri backend:

- **Dungeon folder:** an in-memory copy of `examples/sample-dungeon`.
- **Saves:** recorded.
- **Events:** delivered between the two windows.
- **Spotify:** the fake one.

Driver scripts control it over the Chrome DevTools Protocol. They:

- run JavaScript inside either window;
- send real mouse and keyboard input;
- take screenshots.

Look at the screenshots with the Read tool. They are how you catch layout problems (wrapping
toolbars, clipped popups, overlapping panels).

### Run it

Run the Vite server and Chrome **outside the sandbox** (`dangerouslyDisableSandbox: true`):

```sh
node tools/e2e/fixture.mjs                  # build tools/e2e/fx/ from the committed sample (--worktree: as on disk)
npx vite --port 1420 --strictPort &         # in the background; restart it if the page seems stale
node tools/e2e/smoke.mjs                    # PASS/FAIL lines, screenshots in tools/e2e/shots/
```

Port 1420 is also what `npm run app:dev` uses, so stop one before starting the other.
Afterwards, stop Vite (`lsof -ti tcp:1420 | xargs kill`).

The harness finds Chrome by itself: the usual app on macOS, and on Linux the first of
`google-chrome`, `google-chrome-stable`, `chromium` or `chromium-browser` on the `PATH`. Set
`CHROME` to use another browser binary; `E2E_URL` changes the Vite address.

`fx/`, `shots/` and `.chrome-profile/` are gitignored.

### Write a driver

Copy `tools/e2e/smoke.mjs`. It ends with a `run(async (h) => { ... })` block, which starts
Chrome, opens the sample dungeon in the DM window, catches errors (an error screenshot is saved
as `shots/error.png`) and prints console errors from the app at the end.

Options for `run(body, opts)`:

- **`spotify: "connected"`** (the default) is logged in to the fake Spotify. **`"connect"`**
  starts on the Connect screen, and the login flow works.
- **`open: false`** stays on the start screen.
- **`patch: (fx) => {...}`** edits the fixture before the app loads it. For example, add notes
  with `fx.notes["Stats/Goblin.md"] = "..."`, or change `fx.dungeon["dungeon.json"]` (parse it,
  edit it, stringify it).

Members of `h`:

| Member | What it does |
| --- | --- |
| `h.dm(js)` / `h.player(js)` | Run a function body inside that window and return a JSON value. `await` is allowed. Inside, `window.Konva` reaches the canvases. |
| `h.top(js)` | Run in the harness page. It has `window.__saved` (every `save_files` write), `__playerData` (every payload sent to the player), `__calls` (backend commands), `__settings` and `__fake` (the fake Spotify: `devices`, `playlists`, `player`, `log`). |
| `h.click(selector, text?, {modifiers, clickCount, frame})` | A real mouse click on the first element that matches and contains `text`. |
| `h.clickAt(x, y)`, `h.drag(from, to)`, `h.locate(selector, text)` | Mouse input at page coordinates. The DM iframe is at (0,0) with size 1400×860; the player iframe is at (0,866) with size 960×600. |
| `h.key("4", META)`, `h.key("Escape")`, `h.type("text")` | Keyboard input. `META`, `SHIFT` and `ALT` are exported. Call `h.focusDm()` after clicking into the player iframe. |
| `h.waitFor(js, ms, frame)` | Poll until `js` returns something truthy. Prefer it to fixed sleeps. |
| `h.check(cond, message)` | Print PASS or FAIL. Any FAIL makes the exit code 1. |
| `h.shot(name, clip?)` | Save a screenshot to `tools/e2e/shots/<name>.png`. `DM_CLIP` and `PLAYER_CLIP` are exported. |
| `h.dmStage()` | The DM map's Konva transform. To click a grid point: `left + x + gx*scale`, `top + y + gy*scale`. |
| `h.logs` | Console errors and warnings collected so far. |

Selectors you'll often need:

| Selector | What it is |
| --- | --- |
| `.recent-list button` | The start screen's recent dungeons. |
| `.toolbar` | The DM toolbar. |
| `.dm-main` | The Dungeon view. |
| `.dm-map-area canvas` | The map. |
| `.side-panel .entity-list button` | Rooms in the level overview. |
| `.left-dock`, `.player-preview` | The combat panel and preview at the bottom left. |
| `.notes-main .cm-content` | The open note's editor. |
| `.tree-row.note` | A note in the file tree. |
| `.peek-panel` | A note peeked over the map. |
| `.combat-view` | The Combat tab. |
| `.music-host` | The Music tab. |
| `.player-root` | The player window (in `h.player`). |

When a selector isn't listed, grep `className=` in the component.

Notes and gotchas:

- **Duplicate components.** The DM DOM has some components twice (`CombatPanel` on the Dungeon
  and Notes views). Scope selectors with `.dm-main`, `.notes-host` or `.combat-view`.
- **Typing into CodeMirror.** Click into `.cm-content`, then `h.type(...)`. Setting `value`
  doesn't work on CodeMirror, and for React inputs it skips `onChange`. Use real input.
- **Unmocked backend commands.** These return `null`: `import_asset`, `notes_move`,
  `notes_trash`, monitors and windows. If your feature depends on one, add a `case` in
  `tools/e2e/frame.ts`.
- **Spotify fake IDs.** Playlist ids must be at least 10 characters, or Spotify link parsing
  ignores them.
- **No sound.** Headless Chrome has no audio output. Test sound triggers with unit tests.
- **Toolbar width.** To check the toolbar still fits one row, compare
  `document.querySelector(".toolbar").getBoundingClientRect().height` before and after your
  change. Do it with a song loaded (`spotify: "connected"`, then play something).

### What it can't test

These have no e2e coverage:

- the real Spotify account;
- real multi-monitor and fullscreen;
- native file dialogs;
- the Rust side.

For those, build the app (`npm run app:build`) and ask the user to try it. Tell them exactly
what to check.
