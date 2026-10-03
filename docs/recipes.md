# Recipes

Checklists for the changes that come up most often. Each one lists every place that has to
change, because missing one usually doesn't fail loudly. Search for an existing example (named
in each recipe) and copy its pattern.

## Save a new piece of live-play state with the dungeon

Example: `brightness` (player-window brightness). Use this for state the DM changes during
play that should survive a restart but **not** be undone with ⌘Z.

1. `src/types.ts`: add the field to `Session` and give it a value in `DEFAULT_SESSION` (plus
   min/max constants if it is a number).
2. `src/store/session.ts`: add a setter to `SessionState` (clamp/validate there), and add the
   field to `persistedSession()`. Without that it isn't saved, and changes don't trigger autosave.
3. `src/lib/serialize.ts`: write it in `serializeDungeon` (`session: {...}`) and read it in
   `parseDungeon`, with a default when missing or invalid (older dungeons don't have it).
4. Tests: `src/lib/serialize.test.ts` round-trips the session and should cover the
   default/clamping. Update the full `Session` object in `src/store/doc.test.ts`
   (`setSession({...})`). `npm run typecheck` will find other complete `Session` literals.
5. `examples/sample-dungeon/dungeon.json`: add the field with its default. Otherwise the first
   time the user opens the sample, the app rewrites the file. Only edit that one key. If
   `git diff` shows the user's own uncommitted edits in the file too, don't commit it. Tell the
   user instead.
6. If players should see it: see "Show something new on the player window".
7. README: mention it in the feature description and in the `dungeon.json` line of *Dungeon
   format*.

## Add content to the dungeon document (undoable)

Example: `playlists` on `Dungeon`, room `title`. Use this for things the DM *authors*.

1. `src/types.ts`: the field on `Dungeon` / `Level` / `Room`...
2. `src/store/doc.ts`: an action on `DocState`. Mutate with immer `produce` like the existing
   actions. For text typed key by key, pass a `coalesceKey` so one burst of typing is one
   undo step. Selection/focus guards in `DmApp.tsx` (`useSelectionGuard`) handle entities
   disappearing on undo.
3. `src/lib/serialize.ts`: where it lives on disk. Small data goes in `dungeon.json` or
   `level.json`; prose goes in its own `.md` file (empty text → no file; images are
   root-relative in memory and converted with `toFileRelative`/`toRootRelative`). Parse
   tolerantly.
4. If it is text: should it be searchable and linkable? Add it to `src/notes/sources.ts`
   (`FieldRef`, `dungeonTexts`) and decide whether it appears in level documents
   (`src/notes/levelDoc.ts`).
5. Tests in `serialize.test.ts` (round trip, old files without it) and `doc.test.ts` (action and
   undo); update `examples/sample-dungeon` like above.
6. README *Dungeon format*.

## Show something new on the player window

1. `src/lib/playerData.ts`: add it to `PlayerData` and fill it in `buildPlayerData`. **Only
   what is safe for players.** Filter here, not in the player.
2. `src/player/PlayerApp.tsx` (and/or `src/map/PlayerMapView.tsx`) renders it.
3. `src/dm/PlayerPreview.tsx` renders the same thing, so the DM sees what the TV shows.
   Prefer putting the rendering in a shared component used by both.
4. One-shot actions (like a ping) are events, not `PlayerData` fields: add a name to `EVENTS`,
   `emit` from the DM, `listen` in the player and the preview.
5. E2E check: `h.player(...)` to inspect the player iframe, and `window.__playerData` (in
   `h.top`) has every payload sent.

## Add an app-wide preference (not per dungeon)

Example: `sfxVolume`, `musicTransition`, `generalPlaylists`.

1. `src/lib/prefs.ts`: add it to `Prefs`, `DEFAULT_PREFS` and the validation in `load()`.
2. Change it with `usePrefs.getState().update({ key: value })`. It saves through
   `update_settings`; Rust keeps unknown keys (`Settings.extra`), so no Rust change is needed.
3. Never store secrets anywhere else. Spotify credentials stay in prefs.

## Add a backend (Rust) command

Only when the webview can't do it (file system, windows, OS integration).

1. `src-tauri/src/lib.rs`: `#[tauri::command] fn name(...) -> Result<T, String>`, register it in
   `invoke_handler(tauri::generate_handler![...])`. Resolve dungeon paths with `safe_join`. Add a
   `#[test]` for the logic.
2. `src/lib/backend.ts`: a typed wrapper on `backend`. Arguments are camelCase in TS and
   snake_case in Rust (Tauri converts).
3. If it needs a plugin or permission: `src-tauri/Cargo.toml`, `capabilities/default.json`
   (ask the user before adding dependencies).
4. `tools/e2e/frame.ts`: add a `case` for it to the mocked backend if the UI calls it during
   e2e tests.
5. `npm run test:rust` and `npm run app:build` (sandbox off) to be sure it compiles.

## Add a main view / tab (like Music or Combat)

1. `MainView` in `src/notes/store.ts`.
2. `DmApp.tsx`: render it (`{mainView === "x" && <div className="x-host">...}`) and add the
   ⌘-number shortcut in `useNotesKeys`.
3. `Toolbar.tsx`: a button in the view switch. Check the toolbar still fits one row at 1400px
   (measure it in an e2e driver: compare the `.toolbar` height with one row).
4. README: the views list and the shortcut table.

## Add a keyboard shortcut

- Global shortcuts are `window` keydown listeners in `DmApp.tsx` (`useNotesKeys`,
  `useTurnKeys`). Skip them while the user types (`isTextInput`) unless they should work
  everywhere (⌘J does, so it listens in the capture phase).
- Editor-only shortcuts go in a CodeMirror keymap (`src/editor/commands.ts`).
- Don't take shortcuts CodeMirror or macOS already use (⌘Z, ⌘F inside editors, ⌘W...). Add
  it to the README shortcut table.

## Make a panel resizable

`useResizableWidth(storageKey, initial, min, max, edge)` from `src/components/useResizableWidth.ts`:
put `style={{ width }}` on the panel (which needs `position: relative`) and
`<div className={`panel-resize ${edge}`} {...handleProps} />` inside it. If the panel scrolls,
put the content in an inner scrolling div so the handle doesn't scroll away (see `SidePanel`).

## Add a markdown feature (rendering in every text box)

1. Decoration in `src/editor/livePreview.ts` (look at how wiki links or Spotify chips are
   done: a `WidgetType` plus a click handler in `linkClicks`).
2. If it needs app data or actions, add a member to `EditorContext` (`src/editor/context.ts`)
   and implement it in both `fieldContext` and `noteContext` (`src/editor/appContext.ts`).
3. If it changes when app data changes, bump `useNotes.indexVersion` when that data changes so
   editors redraw.

## Use the SRD / stat blocks

- Monsters/conditions: `SRD_MONSTER_LIST`, `srdMonster(id)`, `srdCondition(id)` in
  `src/rules/srd.ts`. The user's stat blocks: `src/rules/statNotes.ts` (`noteStatblock(path)`,
  `resolveStats(key)`, `statsOptions()` for autocomplete).
- More SRD data (spells, items...) means extending `scripts/build-rules-data.mjs`, which needs
  local checkouts of the source repos (see the script's header) and the sandbox off. Keep the
  README credits up to date (CC-BY-4.0 attribution is required).

## Use Spotify

Add endpoints to `src/spotify/api.ts` and behavior to `src/spotify/music.ts`; teach
`fakeSpotify.ts` the endpoint and test against it (`src/spotify/music.test.ts`). The real API
answers some commands with odd bodies; `http.ts` already tolerates them. The user can't easily
test new Spotify scopes: changing `SCOPES` in `auth.ts` means they must reconnect. Say so.
