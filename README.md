# Dungeon DM

A two-window desktop tool for running a dungeon crawl: a **DM window** with the full
map, room descriptions and controls, and a **player window** (for a TV or second screen)
that shows only the rooms the players know about. Everything outside them is blacked out.

Built with Tauri 2 (Rust), React, TypeScript, Konva (map canvas), TipTap (markdown
editing) and Zustand + zundo (undo/redo).

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
2. **Levels.** The toolbar has a levels dropdown (switch levels, 🗑 delete one), **+ Level**
   (name, grid size, feet per square, description, DM/player background images),
   **Edit level**, and **Level description**. **Background** opens the dungeon-wide
   background document.
3. **Background images.** Each level can have a DM image and a player image. Use
   **Calibrate…** to line an image up with the grid. You can drag it, set its
   offset and size, enter the image's pixels per square, or fit it to the grid.
4. **Drawing.** **+ Room**, **+ Door** and **+ Object** (global objects) each offer
   box, circle, freeform and polygon tools. Points snap to the grid (change this with
   the Snap selector; hold <kbd>Alt</kbd> to ignore it). For polygons, click to add
   corners, then close the shape by clicking the first corner, double-clicking, or
   pressing <kbd>Enter</kbd>. Corridors are just rooms. New rooms get the lowest free number.
5. **Running a room.** Click a room on the map (or in the side list). You get its
   **read-aloud** text and **DM notes**, plus these actions:
   - **Reveal**, or **Reveal & focus player window**
   - **Conceal** (not allowed on the room the player window is focused on)
   - **Focus player window**, which zooms the player view to the room
   - **Edit shape**: drag corners, click a midpoint to add a corner, double-click a
     corner to remove it, or drag the whole shape
   - **Redraw** and **Delete**
   - Click the ✎ next to the title to change the room number (it must be unique on the
     level).
6. **Player window.** It shows the revealed rooms over the player background image with
   the grid on top, and highlights the focused room. Players can zoom, pan, and switch
   between levels that have at least one revealed room. Doors, objects and all text are
   never sent to it. Press <kbd>F</kbd> in it to toggle fullscreen.
7. **Player preview.** The bottom-left panel in the DM window mirrors exactly what the
   player window shows. Drag its right edge to resize it, or ▁ to minimize it.
8. **Windows menu.** Show the player window, turn its fullscreen/kiosk mode on or off,
   and assign each window to a display. These choices are remembered between sessions.

Every change is saved automatically. <kbd>Ctrl/⌘+Z</kbd> undoes and
<kbd>Ctrl/⌘+Shift+Z</kbd> redoes; inside a text editor these keys undo your typing.
<kbd>Esc</kbd> cancels drawing, leaves shape editing, or clears the selection.
In descriptions, ⌘/Ctrl-click a link to open it in your browser. Use the 🖼 button to
insert an image; it is copied into the dungeon's `assets/` folder.

## Dungeon format

A dungeon is a plain folder, easy to read and friendly to git:

```
my-dungeon/
  dungeon.json                    name, level order, player-window session state
  background.md                   dungeon background document
  assets/                         images (backgrounds, images in descriptions)
  levels/<level-id>/
    level.json                    grid size & scale, background images + calibration,
                                  room / door / object polygons, player-known flags
    description.md                level description
    rooms/<n>.read-aloud.md       read-aloud text of room <n>
    rooms/<n>.dm.md               DM notes of room <n>
    doors/<door-id>.md            door descriptions
    objects/<object-id>.md        global object descriptions
```

Polygons are lists of `[x, y]` points in grid squares. Markdown files reference images
with paths relative to themselves, so they also display correctly in other markdown
viewers. Empty descriptions have no file.

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
