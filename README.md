# Cannon Capture

A small battle prototype by **SleepyMie**. Cannons sit on a board and fire on their own. Hit a cannon enough times and it flips to your colour and starts shooting for you. Walls block shots. A fan shoves them off course.

The look uses the colour themes from ChocoNeko, SleepyMie's studio ([`css/themes.css`](https://github.com/SleepyMieMoo/choconeko-site/blob/main/css/themes.css)). Only the colours are shared, with no ChocoNeko characters or story.

It's a standalone browser game with a campaign of ten levels (battles against an AI and aim-budget puzzles), a quick skirmish, and a map editor for making and sharing your own boards. A Discord Activity build comes later.

## How to play

You are gold. The enemy is strawberry pink. Warm grey cannons are neutral and do not fire until someone captures them.

1. Click one of your cannons to select it (it gets a pulsing ring).
2. Click anywhere on the board to set that spot as its aim point, or click an enemy or neutral cannon to aim at it. Free aiming lets you lead shots, bank them off walls, or let a fan carry them.
3. Cannons don't snap. The barrel turns toward its aim at a limited speed, and a cannon only fires once it has finished turning and is lined up. After that it fires about once a second. The fire timer keeps counting while the barrel turns, so a long turn doesn't add an extra wait: the cannon fires as soon as it lines up, if its timer is ready. Big swings still cost you shots, because nothing fires mid-turn.
4. Setting an aim deselects the cannon automatically, so a stray extra click can't re-aim it. To re-aim, select it again. Before aiming, click the selected cannon again (or press **Esc**) to cancel, or click another of your cannons to switch to it.

A cannon tints toward whoever is hitting it, and a ring around it fills in their colour. At eight hits it flips. Capture every cannon to win. Lose when none are yours. A newly captured cannon swings toward the nearest foe on its own.

**Healing.** Each cannon has one capture meter, like a tug of war:

- Your own shots heal your cannons. If pink is part-way through capturing one of your gold cannons, select another gold cannon and click the damaged one. Every hit takes one point of pink's progress back off, so the tint and the ring shrink and a gold ring pulses out with a "+1 heal" popup. Once it is whole, the healer goes back to whatever it was aiming at before.
- A healthy cannon can't be overhealed: friendly shots that hit a cannon at full health just stop there and do nothing.
- Neutrals work the same way. If pink is part-way through a neutral and you shoot it, you push their progress back first. Once their progress is gone, your hits start counting toward your own capture (and the other way round).
- The enemy heals too. Once you are halfway through one of its cannons, it sends its nearest cannon with a clear shot to heal it.
- Clicking a damaged gold cannon while another one is selected heals it. Clicking a healthy gold cannon still switches the selection.
- Heals scale with the shot: a sniper heal takes off 2, a machine gun heal 0.3 (a burst of machine gun heals shows as one summed popup, like "+1.5 heal").

**Tower types.** Every cannon has a type, and a captured cannon keeps its type (if pink takes your sniper, they get a sniper).

| Type | Fire rate | Damage per hit | Shots | Turn speed | Accuracy | Look |
| --- | --- | --- | --- | --- | --- | --- |
| Normal | Every 1 s (some early levels slow pink down) | 1 | Normal speed and range | 110°/s | Up to ±1.25° off | Short, thick barrel |
| Sniper | Every 3 s | 2 | 2× speed and 2× range | Half (55°/s) | Exact | Long, thin barrel with a scope, a reticle on the body and two dots; long thin shot streaks |
| Machine gun | Every 0.2 s (5 a second) | 0.3 | Normal speed, half the range | Double (220°/s) | Up to ±7° off | Twin short, chunky barrels with alternating flashes, three bars on the body; small, short tracers |

- Every shot lives 4.5 s, so a normal shot reaches about 1,530 px (up to 3 wall bounces). Sniper shots fly twice as fast for the same time, about 3,060 px. Machine gun shots fly at normal speed for half the time, about 765 px.
- Snipers do less damage per second (2 every 3 s) but have reach, perfect aim, and fast shots that punch through headwinds. They turn slowly, so re-aiming one takes a while.
- Machine guns do the most damage per second (1.5) but only up close, and their spread makes long or narrow bank shots miss. They swing onto a new target fast.
- Normal cannons now wobble a little (up to ±1.25°), so a very narrow bank shot can miss now and then. The spread is random but seeded per cannon, so a replay is the same every time.
- Every type only fires once its barrel is lined up. Damage can be a fraction (0.3): the capture meter, healing, tint and ring all track it exactly.
- When a level slows pink's fire rate (for example 1.3 s instead of 1 s), its snipers and machine guns slow by the same factor.

**Swapping type in play.** Hover one of your cannons and a small menu (Normal / Sniper / Machine gun) pops up above it. Click one to swap. On touch, long-press a cannon, or tap the selected cannon again. With a cannon selected, **T** steps it to the next type (Normal → Sniper → Machine gun).

- After a swap the cannon reloads for its new type's full interval (at least 1 s) before it shoots again: 1 s for Normal or a Machine gun, 3 s for a Sniper. A light ring on the cannon fills up while it reloads. So swapping back and forth never gains you damage.
- In puzzles, swapping is free and does not spend an aim.
- While a cannon is selected for aiming, only that cannon's own menu shows, so the menu never covers an aim click elsewhere.
- Pink picks a type for each cannon's current job, the cannon it is attacking or the friend it is healing. It estimates how long each type would take to finish that job: the swap reload, plus the damage still needed divided by the type's expected damage rate on that lane. That rate counts how much of its spread actually lands. So a cannon goes machine gun when its target is close (on open ground, within about 300–350 px of a single cannon; further out so many spread shots miss that a normal cannon does more), sniper when only a sniper reaches (very far, or through a headwind), and normal otherwise. It keeps its type unless another is clearly quicker (Easy 1.4×, Normal 1.15×, Hard 1.08×), and it swaps a given cannon at most every 6 / 3.5 / 2.5 s (half that while healing a friend under attack; no wait if its current type can't hit the job at all). Its swaps follow the same rules as yours, reload included. If none of its cannons can reach one of yours as fitted, it sends the one that can after a swap.

The enemy obeys the same turn speed. Your aim shows as a gold dashed line with a crosshair at free aim points; while a cannon is selected, a pale line previews where your next click would aim. Faint pink lines are the enemy's. The mint ring is a fan blowing downward. P1 starts aimed into the tall wall, so re-aim it. Restart from the corner, or press **R** on the end screen. Works with taps on touch screens too.

## Campaign

Start from the title screen. **Campaign** opens a map where levels unlock in order. Beat a level to open the next one. Progress (best stars per level) is saved in this browser's `localStorage` under `cannon-capture:progress:v1`. **Quick skirmish** jumps straight into the original battle board.

There are two kinds of level:

- **Battle:** beat the pink AI by capturing every cannon. Stars come from how fast you win (3 stars at or under par, 2 within 1.5× par).
- **Puzzle:** no enemy. Capture every neutral with a limited number of aims (each click that sets an aim spends one). Nothing auto-aims in puzzles, not even freshly captured cannons. If you run out of aims and the board goes quiet for 5 seconds, the puzzle fails. Stars come from aims used (3 at par, 2 at one over).

| # | Level | Type | Teaches |
| --- | --- | --- | --- |
| 1 | First Shots | Puzzle (unlimited aims) | Selecting, aiming, capturing, and aiming captured cannons |
| 2 | Tug of War | Battle | An enemy that fights back over one middle cannon |
| 3 | Bank Shot | Puzzle (3 aims) | Bouncing a shot off a wall to get over a blocker |
| 4 | Walls Up | Battle | Fighting around walls, corners first |
| 5 | Tailwind | Puzzle (3 aims) | Using a fan to curve a shot down behind a wall |
| 6 | Crossfire | Battle | Walls and wind together (the skirmish board) |
| 7 | Cocoa Maze | Puzzle (5 aims) | Planning capture order so each new cannon has a shot |
| 8 | Last Stand | Battle | Outnumbered 3 against 4; spread out and grab the neutrals fast |
| 9 | Long Shot | Puzzle (3 aims) | Snipers: only P1, a sniper, can punch through the headwind to N1, and N3 needs a cannon swapped to Sniper |
| 10 | Sniper Duel | Battle | Pink's 3 s sniper hides behind the wind; swap a cannon to Sniper to reach it, and heal what is close to flipping |

Early battles go easy on you: the enemy fires a little slower (`ai.fireMs`) in levels 2, 4 and 6. Last Stand is a fair fight.

### Every level is checked to be beatable

`npm test` runs every campaign level headless with an autoplayer that follows the same rules you do: same turn speed, same aim budget, and it only re-aims every couple of seconds. Puzzles must be solved within their aim budget, and battles must be won against the real enemy AI at three different frame rates. The same autoplayer can play in the browser: `?level=<id>&debug&bot&speed=10` (add `bot=mirror` for the spread-fire style).

The win checks for Crossfire, Last Stand and Sniper Duel are skipped for now (they still have to load and play without errors). Those levels were tuned before the current tower rules (one 3 s / 2-damage sniper, machine guns, per-type turn speed and spread), and the campaign is due for a redesign.

### Adding a level

1. Add a `LevelDef` to `CAMPAIGN` in [`src/levels/campaign.ts`](src/levels/campaign.ts), or build it in the map editor and paste its JSON (see [Map editor](#map-editor-and-my-maps)). The Small board is x 24–1176, y 88–696 (`size` makes it bigger), and cannons have a 26 px radius. Fields:
   - `id`, `name`, `hint` (one line, shown on the map card and as a banner when the level starts)
   - `kind: 'puzzle'` (otherwise it's a battle), and `aims` (the budget) for puzzles
   - `par` (seconds for battles; aims for puzzles with a budget)
   - `ai: { retargetMs, fireMs }` to tune the enemy
   - `size`: `small` (default), `medium`, `large` or `huge`
   - `cannons` (`side`, optional `aimAt` cannon id or `aimPoint`), `walls` (rectangles, optional `angle` in radians about the centre), `fans` (`angle` in radians, `force`)
2. Add a map position for it in `NODES` in [`src/scenes/MapScene.ts`](src/scenes/MapScene.ts) (one per level, in order).
3. Run `npm test`. It fails if a puzzle can't be solved within its budget, a battle can't be won by the autoplayer, or a cannon overlaps a wall or the board edge.
4. Play it: `npm run dev`, then open `http://localhost:5173/?level=<id>`.

## Map editor and My maps

The title screen has **Map editor** and **My maps**.

The editor builds a normal `LevelDef` (the same format as the campaign), so anything you make can be played, shared, or dropped into the campaign.

Everything sits in two slim bars at the top, so the board gets the full width:

- **Top toolbar:** the tools (Move, Gold, Enemy, Neutral, Wall, Fan, Delete), undo/redo, Snap, **Map ▾**, **Share ▾**, **?** (controls), then **Playtest**, **Save**, **My maps** and **Menu**.
- **Second bar:** the map name, the settings for whatever is selected, the save/validation status, and the zoom − / % / + / Fit buttons.

- **Place:** pick a tool and click the board. The tools are gold, enemy and neutral cannons, walls, and fans.
- **Move:** drag anything. A short click just selects it.
- **Delete:** use the Delete tool, or select something and press Del.
- **Edit the selection** right in the second bar:
  - cannons: owner, **Type** (Normal / Sniper / Machine gun) and an optional starting aim. Click **Set aim**, then a cannon or a spot on the board. Press **T** to step the selected cannon through Normal → Sniper → Machine gun. The type set here is the cannon's starting type in play.
  - walls: length, thickness and rotation in 15° steps.
  - fans: direction, strength and radius.
- **Snap to grid** (16 px) is on by default. **Undo/Redo** cover every edit, including New map and Import.
- **Map ▾:**
  - name
  - mode: Battle against the AI, or Puzzle with an aim budget (or unlimited)
  - AI difficulty for battles
  - size
  - an optional hint banner
- **Share ▾:** get or paste a share code (`CC1:...`), or download/upload a `.json` file.
- **Playtest** jumps straight into the map, starting at the editor's view (zoom capped at near). **Editor** (top right, or the end screen) brings you back to the same working copy at exactly the zoom and position you left.
- **Validation:** a map needs at least one gold cannon. Battles also need an enemy. Puzzles need neutrals and no enemy.
- The working copy is kept as a draft in `localStorage`, so a reload or a playtest never loses it. The camera (zoom and position) is saved with the draft and with each saved map, so a map reopens where you left it. A new map opens fitted to the board.

### Map sizes and the camera

| Size | Board |
| --- | --- |
| Small | 1152×608 (the original board) |
| Medium | 1728×912 (1.5×) |
| Large | 2304×1216 (2×) |
| Huge | 3456×1824 (3×) |

Bigger maps start at the normal "near" zoom, centred on your cannons. If your cannons are spread wider than one screen, the camera starts a little further out to show more of them (never below 70%). You can then zoom out to see the whole board. The editor uses the same camera.

| Action | Mouse / keys | Touch |
| --- | --- | --- |
| Zoom | Mouse wheel, or the + / − / Fit buttons (editor: + / − / 0 keys too) | Pinch |
| Pan | Drag empty space, or WASD / arrow keys | Drag with one finger |
| Aim (play) | Click your cannon, then the target. Works at any zoom. | Tap, tap |

In play you can zoom out but not past the near view. The editor can also zoom in to 160% for fine placement.

The enemy AI works on any size and any number of cannons. It still plans with lanes (which angles hit which cannon). On big maps those lanes are built a few milliseconds per frame, enemy cannons first, and until a cannon's lanes are ready the AI simply aims straight. Traced shots use a spatial grid, so only nearby walls and cannons are tested. On a Huge map with 23 cannons, all the lanes cost about half a second of work in total, spread over the first second or two. The frame rate matches the small board.

### Editor keys

| Key | Action |
| --- | --- |
| 1 / 2 / 3 | Place a gold / enemy / neutral cannon |
| 4 / 5 | Place a wall / fan |
| V | Move/select tool |
| X | Delete tool |
| Del / Backspace | Delete the selection |
| Q / E | Rotate the selected wall or fan by 15° |
| T | Selected cannon: next type (Normal → Sniper → Machine gun) |
| G | Toggle snap |
| P | Playtest |
| Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y) | Undo / redo |
| Esc | Cancel aim picking, or deselect |

### My maps, share codes and files

**Save** in the editor stores the map in this browser (`localStorage` key `cannon-capture:maps:v1`). From **My maps** you can:

- play, edit, rename or delete any map (delete asks twice)
- share it: copy a share code
- download it as `.json`

To bring a map in, paste a share code (or raw JSON) and press **Import code**, or use **Upload .json**. The editor's **Share** tab has the same tools.

A share code is `CC1:` followed by the map's JSON in URL-safe base64, so it fits in a chat message. Imported maps are checked and cleaned first. Older maps that set a sniper delay (2 s or 3 s) still load; the delay is ignored and the cannon becomes the standard sniper. Only known fields are kept, numbers are clamped to the board, item counts are capped (60 cannons, 160 walls, 40 fans), and broken codes are rejected with a message.

### Turning a shared map into a campaign level

1. Get the map's JSON: **.json** in My maps, or **Download .json** in the editor. A share code works too: `decodeShare(code)` in [`src/editor/maps.ts`](src/editor/maps.ts) returns the same object.
2. Paste it into `CAMPAIGN` in [`src/levels/campaign.ts`](src/levels/campaign.ts) as a `LevelDef`:
   - Give it a short unique `id` (the editor makes ids like `custom-…`).
   - Add `par` for stars.
   - Add a `hint` if it doesn't have one.
   - Keep `size` if it isn't Small. Walls may carry an `angle` (radians).
3. Add a map node for it in `NODES` in [`src/scenes/MapScene.ts`](src/scenes/MapScene.ts), then run `npm test`. The beatability checks cover it like any other level.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:5173/. The board scales to fit the window, including a small embedded frame.

```bash
npm test
npm run build
npm run preview
```

`npm run build` writes a static site to `dist/`.

## Tweakable constants

All gameplay numbers live in [`src/config/tuning.ts`](src/config/tuning.ts).

| Constant | Default | What it does |
| --- | --- | --- |
| `fireIntervalMs` | 1000 | Time between shots from one cannon |
| `captureThreshold` | 8 | Capture progress (damage) needed to flip a cannon |
| `turnSpeedDeg` | 110 | How fast a barrel turns toward its aim (degrees per second) |
| `aimToleranceDeg` | 0.5 | A cannon only fires once its barrel is within this many degrees of its aim (turn finished) |
| `shotSpeed` | 340 | Shot speed in pixels per second |
| `fanForce` | 540 | How hard fans accelerate a shot (px/s²) |
| `aiRetargetMs` | 1600 | How often the enemy re-aims |
| `aiFinishBias` | 80 | How strongly the AI finishes a cannon it is already capturing |
| `towers.<type>` | see below | Per tower type (`normal`, `sniper`, `machinegun`): `fireMs`, `damage`, `speedMul`, `lifetimeMul`, `turnMul`, `spreadDeg` |
| `aiSwap.cooldownMs` | easy 6000 / normal 3500 / hard 2500 | Least time between two type swaps of one AI cannon (half while healing) |
| `aiSwap.gain` | easy 1.4 / normal 1.15 / hard 1.08 | How much quicker another type must finish the job before the AI swaps |
| `swapLockMs` | 1000 | Minimum reload after swapping type in play |
| `aiHealAtProgress` | 4 | The AI sends a healer once a foe has this much capture progress on one of its cannons |

Per-type values in `TUNING.towers` (range = `speedMul` × `lifetimeMul` × the normal range):

| Type | `fireMs` | `damage` | `speedMul` | `lifetimeMul` | `turnMul` | `spreadDeg` |
| --- | --- | --- | --- | --- | --- | --- |
| `normal` | null (side's rate: `fireIntervalMs`, or a level's `ai.fireMs`) | 1 | 1 | 1 | 1 | 1.25 |
| `sniper` | 3000 | 2 | 2 | 1 | 0.5 | 0 |
| `machinegun` | 200 | 0.3 | 1 | 0.5 | 2 | 7 |

Colours live in [`src/config/theme.ts`](src/config/theme.ts), so the board can be reskinned without touching gameplay. All 11 themes are there as data; change `ACTIVE_THEME` to switch (default: Dark Choco). The level layout is data in [`src/levels/skirmish.ts`](src/levels/skirmish.ts).

## GitHub Pages

Pushes to `main` run [`.github/workflows/pages.yml`](.github/workflows/pages.yml), which tests, builds, and deploys to GitHub Pages.

The production base path is `/cannon-capture/`, so the prototype is meant to be played at:

https://sleepymiemoo.github.io/cannon-capture/

In the repo settings, set **Pages → Build and deployment → Source** to **GitHub Actions**. The workflow cannot turn that setting on by itself.

## Layout

- `src/scenes` — Phaser scenes: `TitleScene`, `MapScene` (campaign map), `BattleScene` (draws a round and handles clicks), `EditorScene` (map editor) and `MapsScene` (My maps).
- `src/editor` — custom maps: validation, share codes, `localStorage` storage, and list thumbnails.
- `src/sim` — the rules without any rendering: `BattleSim` (one round), capture, aiming, shot physics, the lane `solver` (which angles hit which cannon), `stars`, and the test `bots`. All covered by `npm test`.
- `src/entities` — `Cannon`, `Shot`, `Wall`, and `Fan`.
- `src/ai` — the enemy AI, which aims through lanes (including bank shots) and obeys the same turn speed.
- `src/levels` — campaign and skirmish board data, plus `board.ts`, which holds the map size presets.
- `src/config` — palette, layout, tuning, and `kinds.ts` (the tower types: add a type there, give it a look in `Cannon.draw`, and the swap menu, editor, lanes and AI pick it up).
- `src/render` — crisp high-DPI scaling, the zoom/pan `WorldCamera` shared by play and the editor, and the board surface.
- `src/ui` — buttons, stars, the in-play tower swap menu, and the HTML panel overlay used by the editor and My maps.

## Roadmap

- **Discord Activity.** Embed the build with the Discord Embedded App SDK (auth, activity instance, iframe sizing).
- **Multiplayer.** Share cannon ownership and shots between players, possibly with Colyseus.
