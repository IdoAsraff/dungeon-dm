# Dungeon DM

A two-window desktop tool for running a dungeon crawl: a **DM window** with the full
map, room descriptions and controls, and a **player window** (for a TV or second screen)
that shows only the rooms the players know about. Everything outside them is blacked out.

The DM window has two views: **Dungeon** (the map) and **Notes**, an Obsidian-like
folder of linked markdown notes that also contains a generated document per level.

Built with Tauri 2 (Rust), React, TypeScript, Konva (map canvas), CodeMirror 6
(Obsidian-style live-preview markdown) and Zustand + zundo (undo/redo).

## Running

Requirements: Node.js and a Rust toolchain ([rustup](https://rustup.rs)). On macOS you
also need the Xcode command line tools.

```sh
npm install
npm run app:dev      # run in development mode (hot reload)
npm run app:build    # build "src-tauri/target/release/bundle/macos/Dungeon DM.app"
```

Tests:

```sh
npm test             # frontend unit tests (vitest)
npm run test:rust    # backend unit tests
npm run typecheck
```

## Using it

1. **Pick a dungeon.** On start the DM window asks for a dungeon: open a dungeon folder,
   pick a recent one, or create a new one. The player window opens alongside it.
2. **Levels.** The levels dropdown in the toolbar switches levels, adds one (name, grid
   size, feet per square, description, DM/player background images), edits the current
   one, or deletes one (🗑). **Level doc** opens the level's document in Notes.
3. **Background images.** Each level can have a DM image and a player image. Use
   **Calibrate…** to line an image up with the grid. You can drag it, set its
   offset and size, enter the image's pixels per square, or fit it to the grid.
   Without an image, rooms get a grey-blue flagstone floor.
4. **Drawing.** **+ Room**, **+ Door** and **+ Object** (global objects) each offer
   box, circle, freeform and polygon tools. Points snap to the grid (change this with
   the Snap selector in the drawing banner; hold <kbd>Alt</kbd> to ignore it). For
   polygons, click to add corners, then close the shape by clicking the first corner,
   double-clicking, or pressing <kbd>Enter</kbd>. Corridors are just rooms. New rooms get
   the lowest free number, and the title field is ready for typing; press
   <kbd>Enter</kbd> without a title to keep "Room N".
5. **Running a room.** Click a room on the map (or in the side list, which shows room
   titles). You get its title (click to edit), its **read-aloud** text and **DM notes**,
   plus these actions:
   - **Reveal**, or **Reveal & focus player window**
   - **Conceal** (not allowed on the room the player window is focused on)
   - **Focus player window**, which zooms the player view to the room
   - **Edit shape**: drag corners, click a midpoint to add a corner, double-click a
     corner to remove it, or drag the whole shape
   - **Redraw** and **Delete**
   - Click the ✎ next to the room number to change it (it must be unique on the level).
6. **Player window.** It shows the revealed rooms over the player background image with
   the grid on top. The focused room is shown normally and the other revealed rooms are
   dimmed; with no focused room, everything revealed is shown normally. Players can zoom,
   pan, and switch between levels that have at least one revealed room. Doors, objects,
   titles and all text are never sent to it. Press <kbd>F</kbd> in it to toggle fullscreen.
   The **Players** group in the toolbar controls it:
   - **Blackout**: the player window turns completely black until you click again.
   - **Whole level**: zooms out to everything revealed on the players' current level
     (and clears the focused room).
   - **Rotate / Rotate back**: turns the player view 90° clockwise and back, so tall
     rooms can fill a wide screen. Focusing and "Whole level" fit the rotated view.
   - **Compass**: shows or hides a compass on the player window (it turns with the view).
   - **Hide handout**: appears while an image is shown to the players (see Notes).
7. **Player preview.** The bottom-left panel in the DM window mirrors exactly what the
   player window shows. Drag its right edge to resize it, or ▁ to minimize it.
8. **Windows menu.** Show the player window, turn its fullscreen/kiosk mode on or off,
   and assign each window to a display. These choices are remembered between sessions.

Every change is saved automatically. <kbd>Ctrl/⌘+Z</kbd> undoes and
<kbd>Ctrl/⌘+Shift+Z</kbd> redoes; inside a text editor these keys undo your typing.
<kbd>Esc</kbd> cancels drawing, leaves shape editing, or clears the selection.

### Notes

Switch with the **🗺 Dungeon / 📝 Notes** buttons (or <kbd>⌘1</kbd> / <kbd>⌘2</kbd>).

- **Files.** The sidebar is a folder tree: create notes and folders (＋ buttons,
  <kbd>⌘N</kbd>, or right-click), rename them (double-click, <kbd>F2</kbd>, or click the
  note's title), drag them into folders, and delete them (they go to `notes/.trash`).
  Renaming or moving a note updates every link to it.
- **Editing** works like Obsidian's live preview: markdown is rendered as you write and
  the raw syntax only shows where your cursor is. Headings, bold/italic (<kbd>⌘B</kbd>,
  <kbd>⌘I</kbd>), links (<kbd>⌘K</kbd>), lists, checklists (`- [ ]`), quotes, callouts
  (`> [!warning] Title`), tables, code, tags (`#npc`) and images. Each line follows its own
  direction, so Hebrew is right-to-left. Click the chevron next to a heading to fold
  everything under it; folds are remembered.
- **Links.** Type `[[` to link another note (`[[Note]]`, `[[Note#Heading]]`,
  `[[Note|shown text]]`). Clicking a link opens it, ⌘-click opens it in a new tab, and a
  link to a note that doesn't exist yet creates it. `[[Level name#42]]` links to room 42.
  Links work in room, door and level descriptions too; on the Dungeon view they open the
  note in a side panel (**peek**) without leaving the map, and room links select the room.
  Each note lists its **linked mentions** (backlinks) at the bottom.
- **Images.** Paste or drop an image, or use the 🖼 button. In notes it is stored in
  `notes/attachments/` and embedded as `![[image.png]]` (`![[image.png|300]]` sets the
  width). Hover an image and click **▶ Show to players** to show it full-screen in the
  player window as a handout.
- **Tabs.** Open several notes in tabs; ← / → (<kbd>⌘⌥←</kbd> / <kbd>⌘⌥→</kbd>) go back and
  forward, <kbd>⌘W</kbd> closes a tab. <kbd>⌘O</kbd> opens any note by name.
- **Level documents.** The locked `levels` folder has one document per level, generated
  from the map: the level's **Background**, then **Rooms** with each room's
  **Read-aloud** and **DM notes**. Edit the text of any section (it is the same text as
  in the room panel); the headings and structure can't be changed. **📍 Map** next to a
  room shows it on the map; the room panel's **📝 Level doc** jumps the other way.
- **Search.** <kbd>⌘F</kbd> searches the open note; <kbd>⌘⇧F</kbd> searches everything:
  notes, level documents, and door/object descriptions. Matching ignores upper/lower
  case and Hebrew vowel marks.

| Shortcut | Action |
| --- | --- |
| <kbd>⌘1</kbd> / <kbd>⌘2</kbd> | Dungeon / Notes |
| <kbd>⌘O</kbd> | Open a note or level document by name |
| <kbd>⌘⇧F</kbd> | Search everything |
| <kbd>⌘F</kbd> | Search in the open note |
| <kbd>⌘N</kbd> | New note (Notes view) |
| <kbd>⌘W</kbd> | Close tab |
| <kbd>⌘⌥←</kbd> / <kbd>⌘⌥→</kbd> | Back / forward |
| <kbd>⌘B</kbd> / <kbd>⌘I</kbd> / <kbd>⌘K</kbd> | Bold / italic / link |

## Dungeon format

A dungeon is a plain folder, easy to read and friendly to git:

```
my-dungeon/
  dungeon.json                    name, level order, player-window state (focus, blackout,
                                  rotation, compass)
  assets/                         images (backgrounds, images in descriptions)
  notes/                          your notes: markdown files and folders (Obsidian-compatible)
    attachments/                  images pasted into notes
    .trash/                       deleted notes
  .dungeon-dm/workspace.json      open note tabs and folded headings
  levels/<level-id>/
    level.json                    grid size & scale, background images + calibration,
                                  room titles, room / door / object polygons,
                                  player-known flags
    description.md                level description
    rooms/<n>.read-aloud.md       read-aloud text of room <n>
    rooms/<n>.dm.md               DM notes of room <n>
    doors/<door-id>.md            door descriptions
    objects/<object-id>.md        global object descriptions
```

Polygons are lists of `[x, y]` points in grid squares. Markdown files reference images
with paths relative to themselves, so they also display correctly in other markdown
viewers. Empty descriptions have no file. Level documents are not stored as files; they
are generated from `levels/`. Dungeons from before notes existed had a single
`background.md`; opening them moves it to `notes/Background.md`.

## Example

`examples/sample-dungeon` is a tiny dungeon: one level with two rooms joined by a
corridor and two doors. Open it from the start screen with **Open dungeon folder…**.
The first room is already revealed to the players.

## Code layout

| Path | What |
| --- | --- |
| `src-tauri/src/lib.rs` | Rust backend: dungeon folder I/O (atomic writes, path safety), image import, settings, displays and windows |
| `src/types.ts` | Data model |
| `src/lib/serialize.ts` | Dungeon to/from the folder layout; only changed files are written |
| `src/store/doc.ts` | Dungeon document store with undo history (text edits are merged into one step) |
| `src/store/autosave.ts` | Debounced autosave |
| `src/lib/playerData.ts` | The player-safe subset sent to the player window |
| `src/dm/*` | DM window (toolbar, map and drawing, side panel, dialogs, preview) |
| `src/player/PlayerApp.tsx` | Player window |
| `src/map/*` | Shared canvas pieces (grid, images, pan/zoom, fog-of-war view) |
| `src/editor/*` | CodeMirror setup: live preview, folding, links, image paste, contexts |
| `src/notes/*` | Notes: store, file tree, tabs, level documents, links/backlinks, search, peek |
| `src/lib/wikiLinks.ts` | `[[link]]` parsing, resolution and rewriting on rename |
