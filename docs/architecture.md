# Architecture

How Dungeon DM is put together. Read this first. `README.md` describes the features from the
user's side; its *Code layout* table lists what lives in each folder.

## The big picture

```
┌─────────────── Tauri app (one Rust process) ───────────────┐
│ src-tauri/src/lib.rs: folder I/O, settings, windows,        │
│ Spotify login callback                                      │
│                                                             │
│  ┌── webview "dm" ──────────┐  events   ┌── webview "player" ──┐
│  │ DmApp (src/dm/DmApp.tsx) │ ────────▶ │ PlayerApp            │
│  │ all stores, autosave,    │ PlayerData│ (src/player/)        │
│  │ notes, music, combat     │ ◀──────── │ renders fog-of-war   │
│  └──────────────────────────┘ viewport  └──────────────────────┘
└─────────────────────────────────────────────────────────────┘
```

- Both windows load the **same bundle**. `src/main.tsx` picks `DmApp` or `PlayerApp` from
  the window label (`dm` / `player`, declared in `src-tauri/tauri.conf.json`).
- The **DM window owns all state**. The player window only receives a `PlayerData` snapshot
  and sends back its viewport. It never reads the dungeon folder itself.
- There is no server. All network traffic is the Spotify Web API (through
  `@tauri-apps/plugin-http`, which is limited to Spotify hosts in
  `src-tauri/capabilities/default.json`).

## Stores (Zustand)

| Store | File | What | Saved where |
| --- | --- | --- | --- |
| `useDoc` | `src/store/doc.ts` | The `Dungeon` (levels, rooms, doors, objects, texts, pinned playlists). Every change goes through an action here. **Undoable** (zundo + immer; typing in one field within 1.5s is merged into one undo step via `coalesceKey`). | Dungeon folder (autosave) |
| `useSession` | `src/store/session.ts` | Live play state: player focus/level, blackout, rotation, compass, brightness, the combat list/round/turn. Also `handout` and `viewCommand`, which are not saved. **Not undoable.** | `dungeon.json` → `session` (only the fields in `persistedSession`) |
| `useUi` | `src/store/ui.ts` | DM-window UI: open dungeon dir, current level, selection, drawing mode, dialogs, toast, the player viewport. | Not saved |
| `useNotes` | `src/notes/store.ts` | Notes files (in memory), tabs, folds, peek, search, and `mainView` (`dungeon`/`notes`/`music`/`combat`). | Notes: `notes/*.md` (each saved on its own timer). Tabs/folds: `.dungeon-dm/workspace.json` |
| `usePrefs` | `src/lib/prefs.ts` | App-wide settings: sound effects, music transition, "General" playlists, the Spotify login. | Rust `Settings` (the app's config dir on this Mac, not the dungeon) |
| `useMusic` | `src/spotify/music.ts` | Spotify library, open playlist, search, playback state, resume positions. | Not saved (resume points last while the app is open) |
| `useCombatUi` | `src/combat/store.ts` | Combat tab inspector target, cheat sheet open. | localStorage |

Small per-machine UI preferences (panel widths, preview minimized...) use `localStorage` directly
(see `useResizableWidth`, `PlayerPreview`).

Read state outside React with `useX.getState()`; subscribe with `useX.subscribe` (used for
autosave, player sync, sound triggers).

## Loading and saving a dungeon

A dungeon is a folder (layout in the README's *Dungeon format*). The flow:

1. `src/lib/dungeonIO.ts` → `backend.loadDungeon(dir)` (Rust reads every `.json`/`.md` outside
   `notes/`, `assets/` and dot-folders into a `{path: content}` map).
2. `parseDungeon(files)` in `src/lib/serialize.ts` → `{ dungeon, session, warnings }`. Parsing
   is **tolerant**: missing fields get defaults, bad values are clamped or dropped.
3. `useDoc.load(dungeon)`, `useSession.setSession(session)`, `loadNotes(dir)`, then
   `startAutosave(dir, baseline)`.
4. **Autosave** (`src/store/autosave.ts`): on any `useDoc` change or a change to a persisted
   session field, it waits 400ms, runs `serializeDungeon(dungeon, persistedSession(session))`
   (a pure function → file map), diffs it with what was last saved, and calls
   `backend.saveFiles(dir, writes, deletes)`. Only changed files are written. Rust writes
   atomically and refuses paths outside the folder.
5. Notes are saved separately by `src/notes/store.ts` (`setNoteContent` → debounced write of
   that one file). Note moves/renames/trash go through dedicated Rust commands.
6. On window close, `flush()` and `flushNotes()` run.

Markdown in memory refers to images **relative to the dungeon root** (`assets/x.png`). On disk it
is relative to the file itself (`src/lib/markdownPaths.ts` converts), so the files also work in
other markdown apps.

## The player window

- `buildPlayerData(dungeon, session, resolveUrl)` (`src/lib/playerData.ts`) is the **only**
  path for data to reach the players. It sends only known rooms' polygons, the player
  background image, the session view settings and the handout image URLs. Add a field to
  `PlayerData` to show something new to players, and think about whether it leaks DM info.
- `usePlayerSync` in `DmApp.tsx` sends it through the `dm:player-data` event whenever
  `useDoc`/`useSession` change (once per animation frame, skipping duplicates). Event names are
  in `EVENTS`.
- The player sends `player:ready` on mount (the DM replies with a full snapshot) and
  `player:viewport` when its camera moves. The DM mirrors that viewport in `PlayerPreview`.
- **Camera moves** are commands, not state: `useSession.focusRoom` / `showWholeLevel` /
  `toggleRotation` set a `viewCommand` and bump `viewNonce`. The player runs each new nonce
  once. Players can still pan and zoom themselves.
- Pings use a separate `dm:ping` event (not part of `PlayerData`).
- `PlayerPreview` (DM window, bottom left) renders the same `PlayerMapView` component from
  the same data, so it looks exactly like the TV.

## The DM window

`DmApp.tsx` sets up global hooks (player sync, undo keys, ⌘1–4 view keys, ⌘J turns, sound
triggers, the music lifecycle) and renders:

- `Toolbar` (top). One row, full at 1400px. See the toolbar rule in `CLAUDE.md`.
- **Dungeon view** (`.dm-main`): `DmMap` (Konva canvas: drawing, selection, shape editing,
  pings), the `left-dock` (`CombatPanel` above `PlayerPreview`), `PeekPanel` (a note sliding
  over the map), and `SidePanel` (level overview or the selected room/door/object).
- **Notes view** (`.notes-host`): `NotesView` with a second `CombatPanel`.
- **Combat view** and **Music view**: rendered only while active.

The Dungeon and Notes views stay mounted and are hidden with `display:none`, so map and editor
state survives switching. **Some components exist twice in the DOM** (`CombatPanel`), so e2e
selectors must be scoped (`.dm-main ...`, `.combat-view ...`).

Shared UI pieces are in `src/components/`: `Modal`, `Dropdown`, `confirmAsync` + `ConfirmHost`,
`Toast` (`useUi.getState().showToast(text)`), `MarkdownEditor`, and `useResizableWidth`
(drag handle on a panel edge, width kept in localStorage).

## Map (Konva)

- Coordinates in the data are **grid squares** (`Point {x, y}`; 1 = one square). Pixels only exist
  in the view: `src/map/common.tsx` (grid, images, pan/zoom) and `src/map/constants.ts`.
- `src/lib/geometry.ts` holds the pure geometry: snapping, shapes from drawing tools, hit
  testing, bounds, the fit-to-view math. It is unit-tested.
- `src/map/PlayerMapView.tsx` is the fog-of-war view used by the player window and the preview.
  `src/map/effects.tsx` has the fades and pings. `src/map/floorTile.ts` is the default flagstone floor.

## Notes and the editor

- **Documents** (`DocRef`): a note (`notes/<path>.md`), a **level document** (generated from a
  level; `src/notes/levelDoc.ts` keeps the headings fixed and writes edits back into room/level
  fields), or an **SRD** page (read-only, `src/rules`).
- **Every markdown text box** in the app (room texts, door/object descriptions, notes) is
  CodeMirror 6 with the same setup (`src/editor/setup.ts`). Live preview decorations are in
  `livePreview.ts`, heading folding in `folding.ts`, and paste/format commands and `[[`
  autocomplete in `commands.ts`.
- An editor learns how to resolve links and images and what clicks do through the
  `EditorContext` facet (`src/editor/context.ts`). The implementations are in
  `src/editor/appContext.ts`: `fieldContext` for dungeon fields and `noteContext` for notes.
  New link-like behavior (e.g. Spotify ▶ chips) is added as a decoration in `livePreview.ts`
  plus a callback on the context.
- Links: `src/lib/wikiLinks.ts` (parse, resolve, rewrite on rename) and `src/notes/links.ts`
  (index, backlinks, completions, moving with link updates). `src/notes/sources.ts` lists every
  non-note text (`FieldRef`) for search and backlinks.
- **Rooms are identified by a `label`** (string: "12", "2-17C"), unique per level ignoring case.
  It is drawn on the map, used as the link heading (`[[Level 2#2-17C]]`, resolved by
  `levelHeadingTarget`) and as the room's file names (`rooms/<label>.dm.md`). Validation,
  natural sorting and the default label of new rooms are in `src/lib/roomLabels.ts`; always sort
  rooms with `sortedRooms` / `compareRoomLabels`. Relabeling goes through `useDoc.setRoomLabel`
  and then `relinkRelabeledRoom` (links by the old label follow). Old files store a numeric
  `number`, which the parser reads as the label.
- `useNotes.indexVersion` is bumped when link targets may resolve differently. Editors redraw
  their decorations when it changes.

## Rules, stat blocks and combat

- `src/rules/data/*.json` is **generated** by `scripts/build-rules-data.mjs` from local
  checkouts of 5e-bits/5e-database and crobi/dnd5e-quickref. Don't edit it by hand.
  `src/rules/srd.ts` exposes it.
- A **stat block** is a note containing a ```` ```statblock ```` YAML block (the Obsidian
  Fantasy Statblocks format): `src/rules/statblock.ts` (types, YAML in/out, helpers),
  `statNotes.ts` (stat block notes, lookup by reference), `pasteStatblock.ts` (parses text
  pasted from D&D Beyond or a book), `StatblockView.tsx` / `StatNotePane.tsx` (card and
  edit form).
- A combatant links to stats by key: `"note:Stats/Goblin.md"` or `"srd:monster:goblin"`.
  `useSession.remapStats` keeps links working when notes move.
- Combat data lives in `useSession` (saved). The pure rules (HP input, damage with temp HP,
  turn order, condition countdown) are in `src/lib/combat.ts` and unit-tested. UI is in
  `src/combat/*` (the tab) and `src/dm/CombatPanel.tsx` (the compact panel; it reuses
  `CombatList`).

## Music and sound

- `src/spotify/`: `auth.ts` (PKCE; the redirect goes to a one-shot listener in Rust,
  `spotify_authorize`, on `127.0.0.1:8888`), `http.ts` (fetch with token refresh, tolerant
  JSON, `window.__spotifyFetch` override for tests), `api.ts` (typed endpoints), `music.ts`
  (store and all behavior: playback, fades, resume, polling, pinning, link play/labels),
  `links.ts` (URL parsing).
- **`fakeSpotify.ts`** is an in-memory Spotify used by unit tests and the e2e harness. It
  reproduces the real API's quirks (e.g. 200 responses with a text body). Extend it when you
  use a new endpoint.
- `src/audio/sfx.ts` synthesizes the sound effects with WebAudio (no files).
  `triggers.ts` plays them when store changes happen (room revealed, handout shown).

## Backend (Rust)

`src-tauri/src/lib.rs` is a single file of `#[tauri::command]` functions plus their tests.
`src/lib/backend.ts` wraps each one with types; call `backend.x(...)`, not `invoke` directly
(Spotify's two commands are the exception). Path safety: every dungeon-relative path goes through
`safe_join`, which rejects `..` and absolute paths. Use it in new file commands.
`Settings` has a `#[serde(flatten)] extra` map, so the frontend can store new preference keys
(`usePrefs`) **without Rust changes**.

## Styling

- One stylesheet, `src/styles.css`, in sections marked `/* ---- name ---- */`. Add new styles
  at the end of the section they belong to, or in a new section.
- Dark theme only. Use the variables in `:root` (`--bg`, `--bg-2`, `--bg-3`, `--border`,
  `--text`, `--muted`, `--accent`, `--known`, `--danger`, `--focus`, `--radius`) rather than new
  colors.
- Buttons have a label and/or an emoji icon with a `title` tooltip. Text inputs and text
  displays get `dir="auto"` for Hebrew.
