# Dungeon DM

A two-window desktop tool for running a dungeon crawl: a **DM window** with the full
map, room descriptions and controls, and a **player window** (for a TV or second screen)
that shows only the rooms the players know about. Everything outside them is blacked out.

The DM window has four views: **Dungeon** (the map), **Notes**, an Obsidian-like
folder of linked markdown notes that also contains a generated document per level,
**Music**, which plays your Spotify playlists, and **Combat**, a combat tracker linked to
5e stat blocks (the free SRD monsters plus your own).

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
   the lowest free number as their label, and the title field is ready for typing; press
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
   - Click the ✎ next to the room label to change it. A label can be a number or any
     short code from your adventure, like `2-17C` or `B3` (up to 16 characters, unique on
     the level). Links to the room by its old label are updated. Rooms are listed in
     natural order (2, 2-9, 2-10, 2-17A, 10).
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

   **Ping:** hold <kbd>⌥ Option</kbd> and click anywhere on the map (the cursor turns into a
   crosshair). A soft purple pulse appears at that spot on the player screen, in the preview and
   on your map, and fades after two seconds; it works over unrevealed areas too
   ("the scream comes from *here*").

   **Transitions:** newly revealed rooms fade in on the player screen, blackout fades to
   and from black, and handouts fade in, crossfade when you show another, and fade out.
7. **Player preview.** The bottom-left panel in the DM window mirrors exactly what the
   player window shows. Drag its right edge to resize it, or ▁ to minimize it. **☀** in its
   header opens a **brightness** slider for the player window (20%–150%; dim it for a
   dark scene or brighten a dull TV). The preview shows the same brightness, and it is
   saved with the dungeon.
8. **Combat.** The full tracker is the **⚔ Combat** tab (<kbd>⌘4</kbd>); a compact copy sits
   above the preview on the Dungeon and Notes views (click its title to open the tab).
   Only you see it. See [Combat](#combat) below.
9. **Windows menu.** Show the player window, turn its fullscreen/kiosk mode on or off,
   and assign each window to a display. These choices are remembered between sessions.

Every change is saved automatically. <kbd>Ctrl/⌘+Z</kbd> undoes and
<kbd>Ctrl/⌘+Shift+Z</kbd> redoes; inside a text editor these keys undo your typing.
<kbd>Esc</kbd> cancels drawing, leaves shape editing, or clears the selection.

### Notes

Switch with the **🗺 Dungeon / 📝 Notes** buttons (or <kbd>⌘1</kbd> / <kbd>⌘2</kbd>).

- **Files.** The sidebar is a folder tree: create notes and folders (＋ buttons,
  <kbd>⌘N</kbd>, or right-click), rename them (double-click, <kbd>F2</kbd>, or click the
  note's title), drag them into folders, and delete them (they go to `notes/.trash`).
  Renaming or moving a note updates every link to it. Names in the tree start at the left,
  Hebrew ones too.
- **Editing** works like Obsidian's live preview: markdown is rendered as you write and
  the raw syntax only shows where your cursor is. Headings, bold/italic (<kbd>⌘B</kbd>,
  <kbd>⌘I</kbd>), links (<kbd>⌘K</kbd>), lists, checklists (`- [ ]`), quotes, callouts
  (`> [!warning] Title`), tables, code, tags (`#npc`) and images. Each line follows its own
  direction, so Hebrew is right-to-left. Click the chevron next to a heading to fold
  everything under it; folds are remembered. Tables (`| d10 | Encounter |` …) show as real
  tables; click one to edit its text, and it turns back into a table when the cursor
  leaves (Hebrew tables run right-to-left).
- **Links.** Type `[[` to link another note (`[[Note]]`, `[[Note#Heading]]`,
  `[[Note|shown text]]`). Clicking a link opens it, ⌘-click opens it in a new tab, and a
  link to a note that doesn't exist yet creates it. `[[Level name#42]]` links to room 42, `[[Level name#2-17C]]` to room 2-17C.
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
| <kbd>⌘1</kbd> / <kbd>⌘2</kbd> / <kbd>⌘3</kbd> / <kbd>⌘4</kbd> | Dungeon / Notes / Music / Combat |
| <kbd>⌘J</kbd> / <kbd>⌘⇧J</kbd> | Next / previous turn (works everywhere) |
| <kbd>⌘O</kbd> | Open a note or level document by name |
| <kbd>⌘⇧F</kbd> | Search everything |
| <kbd>⌘F</kbd> | Search in the open note |
| <kbd>⌘N</kbd> | New note (Notes view) |
| <kbd>⌘W</kbd> | Close tab |
| <kbd>⌘⌥←</kbd> / <kbd>⌘⌥→</kbd> | Back / forward |
| <kbd>⌘B</kbd> / <kbd>⌘I</kbd> / <kbd>⌘K</kbd> | Bold / italic / link |

### Combat

The **⚔ Combat** tab (<kbd>⌘4</kbd>) has three columns: a **cheat sheet** on the left
(movement, actions, bonus actions, reactions, conditions, cover, light and vision; « hides
it), the **combatant list** in the middle, and the **inspector** on the right.

- **Adding:** type a name, <kbd>Tab</kbd>, optionally the **stats** (autocomplete: your own
  stat blocks first, then the SRD monsters), <kbd>Tab</kbd>, the HP (pre-filled with the
  stat block's average — change it or just go on), optionally <kbd>Tab</kbd> and the
  **initiative**, <kbd>Enter</kbd>. `Goblin x4` adds Goblin 1–4 (sharing the initiative).
  With stats, AC is filled in too; party members can just have AC and HP.
- **A line:** turn marker ▶ · ⋮⋮ grip (drag to reorder) · initiative · Enemy/Party · name ·
  stats · condition icons · ✦ apply condition · AC · HP / max · ✕. HP turns orange at half
  and the line fades at 0. Type `-7`, `+5` or a number in HP as before.
- **Initiative:** type a number in a line's first box and the line moves to its place,
  highest first. <kbd>Tab</kbd> jumps to the next line's box, so you can go round the
  table: `15` <kbd>Tab</kbd> `4` <kbd>Tab</kbd> `12` <kbd>Enter</kbd>. Ties go to the higher
  Dex score when both have stat blocks, otherwise the new number goes after the others.
  Lines without a number stay where they are, and you can still drag any line to change
  the order by hand. The app never rolls: you roll and type the results.
- **Stats:** click a line's stats name to see the stat block in the inspector. Each
  combatant keeps its own HP, AC and conditions — editing them never changes the stat
  block. Custom stat blocks have **📝 Open note ↗** to edit them; SRD ones are read-only.
- **Conditions:** ✦ (or the inspector's box) — type a condition and <kbd>Enter</kbd>. Add a
  number for rounds (`frightened 3`) or the exhaustion level (`exhaustion 2`); any other
  text becomes a custom tag (e.g. *Blessed*); *Concentrating* is built in. Hover an icon for
  its name, click it for the rules, right-click it to remove it. In the inspector you can
  change rounds and exhaustion level or remove it.
- **Turns:** **▶ Start combat** / **⏭ Next turn** (<kbd>⌘J</kbd>, also on the Dungeon view's
  panel), ⏮ back (<kbd>⌘⇧J</kbd>), ⏹ ends the fight: the round count stops and initiative
  is cleared for the next one (the list stays). The list order is the turn order.
  Timed conditions count down at the end of their creature's turn; when one runs out you
  get a notice.
- **Inspector:** HP with **Damage** / **Heal** (temporary HP is used first; healing stops at
  max HP), initiative, AC, max and temp HP, conditions with their rules, a note, and the
  stat block.
- **Show enemy:** if a stat block has an image, **🖼 Show enemy** shows it to the players
  (like a handout). **🖼 Show all enemies** shows every standing enemy's image side by
  side (once per image) until you hide it.
- Everything is saved with the dungeon.

**Stat blocks.** A stat block is a note: **＋📜** in the Notes sidebar (or *New stat block*
on a folder's right-click menu) creates one in `Stats/`, but it can live in any folder.
It shows as a stat block card; **✎ Edit** opens a form (name, size, type, alignment, AC,
HP, speed, abilities, saves, skills, senses, languages, CR, image, traits, actions, bonus
actions, reactions, legendary actions). **📋 Paste** fills it from text copied from
D&D Beyond or a book (check the result). Below the card is the free-text description. The
note uses the `statblock` format of Obsidian's Fantasy Statblocks plugin.

**SRD.** The locked **SRD** folder in Notes has the free 5e (2014) rules: 334 monsters and
the 15 conditions, read-only. `[[Goblin]]` links to them (a note of yours with the same
name wins). **Make a custom copy** turns an SRD monster into your own editable stat block.
Content from later books isn't included — paste those stat blocks from your own books.

### Music and sound effects

**🎵 Music** (<kbd>⌘3</kbd>) remote-controls Spotify. The music plays in the Spotify app
on this Mac (or another of your Spotify devices), so keep Spotify open. It needs
**Spotify Premium**.

- **Connecting (once).** At [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)
  create an app: any name and description, Redirect URI
  `http://127.0.0.1:8888/callback`, and tick **Web API**. Paste its **Client ID** on
  the Connect screen and approve in the browser. The Client ID and login are kept in
  this Mac's app settings, never in the dungeon folder. **Disconnect** is at the bottom
  left.
- **Playlists.** **This dungeon** (saved in the dungeon folder) and **General** (shared
  by all dungeons) are your pinned playlists: ＋ adds one of yours or a pasted Spotify
  link, ✕ removes it from the list (never from Spotify), and you drag rows to reorder.
  **All my playlists** lists your whole library with **+Dungeon** / **+General**.
- **Playing.** ▶ plays a playlist, resuming where it was last left while the app is
  open; **⏮ From the start** ignores that. Click a playlist to see its songs; ▶ on a
  song plays it within the playlist. The bar at the bottom has play/pause, previous and
  next, shuffle, seek, volume, the device, and the **transition**: *Immediate cut*,
  *Short fade* or *Slow fade* when switching music (pause and continue are always
  immediate; devices without volume control always cut). If no Spotify app is open,
  the bar offers **Open Spotify**.
- **Toolbar.** While a song is loaded, the 🎵 tab shows its name, with ⏸ and ⏭ next to
  it, on every view.
- **Search** finds songs, playlists and albums. ▶ plays, ＋ adds a song to one of your
  playlists, and found playlists can be pinned. In a playlist you own (or a
  collaborative one) ✕ removes a song, after asking.
- **Links in text.** In notes, room and level texts, `[[` also suggests your pinned
  playlists (🎵) and inserts a link like `[🎵 Tavern](https://open.spotify.com/playlist/…)`.
  Any Spotify playlist, song or album link (a markdown link or a pasted URL) shows a
  ▶ button: click to play it, ⌘-click to show it in the Music view.
- Some playlists made by Spotify (e.g. mixes) can be played but Spotify doesn't let
  apps list their songs.

**Sound effects** play in the DM's speakers: a deep discovery sound when a room is
revealed, a similar one when a handout is shown, and a soft tick for pings. The
Music view has an on/off switch, a volume slider and **Test**. They are generated in
the app (no sound files) and don't need Spotify.

## Dungeon format

A dungeon is a plain folder, easy to read and friendly to git:

```
my-dungeon/
  dungeon.json                    name, level order, player-window state (focus, blackout,
                                  rotation, compass, brightness), combat list (with initiative) and round,
                                  pinned playlists
  assets/                         images (backgrounds, images in descriptions)
  notes/                          your notes: markdown files and folders (Obsidian-compatible)
    attachments/                  images pasted into notes
    .trash/                       deleted notes
  .dungeon-dm/workspace.json      open note tabs and folded headings
  levels/<level-id>/
    level.json                    grid size & scale, background images + calibration,
                                  room labels and titles, room / door / object polygons,
                                  player-known flags
    description.md                level description
    rooms/<label>.read-aloud.md   read-aloud text of the room labeled <label> (e.g. 2-17C)
    rooms/<label>.dm.md           DM notes of that room
    doors/<door-id>.md            door descriptions
    objects/<object-id>.md        global object descriptions
```

Polygons are lists of `[x, y]` points in grid squares. Markdown files reference images
with paths relative to themselves, so they also display correctly in other markdown
viewers. Empty descriptions have no file. Dungeons saved before room labels stored a
whole `number` per room; it is read as the label. Level documents are not stored as files; they
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
| `src/spotify/*` | Spotify: PKCE login, Web API client, playback/fades/resume store, link parsing, a fake Spotify for tests |
| `src/music/*` | Music view, search, toolbar mini-player |
| `src/audio/*` | Synthesized sound effects and what triggers them |
| `src/rules/*` | 5e stat blocks: format, SRD data, stat block notes, paste parser, views |
| `src/combat/*` | Combat tab: list, inspector, cheat sheet, autocompletes |
| `scripts/build-rules-data.mjs` | Regenerates `src/rules/data` and `public/rules-icons` from the open sources |
| `tools/e2e/` | Browser test harness: the real UI with a mocked backend, driven by scripts |

Developer documentation (architecture, recipes for common changes, testing) is in
[`docs/`](docs/); `CLAUDE.md` is the entry point for Claude Code sessions.

## Credits

- 5e rules content: *System Reference Document 5.1* by Wizards of the Coast LLC, licensed
  under [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/legalcode), via
  [5e-bits/5e-database](https://github.com/5e-bits/5e-database) (MIT).
- Combat cheat sheet: [crobi/dnd5e-quickref](https://github.com/crobi/dnd5e-quickref) (MIT).
- Icons: [game-icons.net](https://game-icons.net) (CC BY 3.0).
