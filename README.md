# Cannon Capture

A small battle prototype by **SleepyMie**. Cannons sit on a board and fire on their own. Hit a cannon enough times and it flips to your colour and starts shooting for you. Walls block shots. A fan shoves them off course.

The look uses the colour themes from ChocoNeko, SleepyMie's studio ([`css/themes.css`](https://github.com/SleepyMieMoo/choconeko-site/blob/main/css/themes.css)). Only the colours are shared, with no ChocoNeko characters or story.

It's a standalone browser game with a campaign of eight levels (battles against an AI and aim-budget puzzles) and a quick skirmish. A Discord Activity build comes later.

## How to play

You are gold. The enemy is strawberry pink. Warm grey cannons are neutral and do not fire until someone captures them.

1. Click one of your cannons to select it (it gets a pulsing ring).
2. Click anywhere on the board to set that spot as its aim point, or click an enemy or neutral cannon to aim at it. Free aiming lets you lead shots, bank them off walls, or let a fan carry them.
3. Cannons don't snap. The barrel turns toward its aim at a limited speed, and the cannon keeps firing along wherever the barrel points right now (about once a second). Big swings cost you shots: it holds fire while the barrel is far off target.
4. Click the selected cannon again (or press **Esc**) to deselect. Click another of your cannons to switch to it.

A cannon tints toward whoever is hitting it. At eight hits it flips. Shots from the other side contest that progress. Capture every cannon to win. Lose when none are yours. A newly captured cannon swings toward the nearest foe on its own.

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

Early battles go easy on you: the enemy fires a little slower (`ai.fireMs`) in levels 2, 4 and 6. Last Stand is a fair fight.

### Every level is checked to be beatable

`npm test` runs every campaign level headless with an autoplayer that follows the same rules you do: same turn speed, same aim budget, and it only re-aims every couple of seconds. Puzzles must be solved within their aim budget, and battles must be won against the real enemy AI at three different frame rates. The same autoplayer can play in the browser: `?level=<id>&debug&bot&speed=10` (add `bot=mirror` for the spread-fire style).

### Adding a level

1. Add a `LevelDef` to `CAMPAIGN` in [`src/levels/campaign.ts`](src/levels/campaign.ts). The board is x 24–1176, y 88–696, and cannons have a 26 px radius. Fields:
   - `id`, `name`, `hint` (one line, shown on the map card and as a banner when the level starts)
   - `kind: 'puzzle'` (otherwise it's a battle), and `aims` (the budget) for puzzles
   - `par` (seconds for battles; aims for puzzles with a budget)
   - `ai: { retargetMs, fireMs }` to tune the enemy
   - `cannons` (`side`, optional `aimAt` cannon id or `aimPoint`), `walls` (rectangles), `fans` (`angle` in radians, `force`)
2. Add a map position for it in `NODES` in [`src/scenes/MapScene.ts`](src/scenes/MapScene.ts) (one per level, in order).
3. Run `npm test`. It fails if a puzzle can't be solved within its budget, a battle can't be won by the autoplayer, or a cannon overlaps a wall or the board edge.
4. Play it: `npm run dev`, then open `http://localhost:5173/?level=<id>`.

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
| `captureThreshold` | 8 | Hits from one side required to flip a cannon |
| `turnSpeedDeg` | 110 | How fast a barrel turns toward its aim (degrees per second) |
| `holdFireAboveDeg` | 75 | A turning cannon holds fire while it is more than this far off its aim |
| `shotSpeed` | 340 | Shot speed in pixels per second |
| `fanForce` | 540 | How hard fans accelerate a shot (px/s²) |
| `aiRetargetMs` | 1600 | How often the enemy re-aims |
| `aiFinishBias` | 80 | How strongly the AI finishes a cannon it is already capturing |

Colours live in [`src/config/theme.ts`](src/config/theme.ts), so the board can be reskinned without touching gameplay. All 11 themes are there as data; change `ACTIVE_THEME` to switch (default: Dark Choco). The level layout is data in [`src/levels/skirmish.ts`](src/levels/skirmish.ts).

## GitHub Pages

Pushes to `main` run [`.github/workflows/pages.yml`](.github/workflows/pages.yml), which tests, builds, and deploys to GitHub Pages.

The production base path is `/cannon-capture/`, so the prototype is meant to be played at:

https://sleepymiemoo.github.io/cannon-capture/

In the repo settings, set **Pages → Build and deployment → Source** to **GitHub Actions**. The workflow cannot turn that setting on by itself.

## Layout

- `src/scenes` — Phaser scenes: `TitleScene`, `MapScene` (campaign map), and `BattleScene` (draws a round and handles clicks).
- `src/sim` — the rules without any rendering: `BattleSim` (one round), capture, aiming, shot physics, the lane `solver` (which angles hit which cannon), `stars`, and the test `bots`. All covered by `npm test`.
- `src/entities` — `Cannon`, `Shot`, `Wall`, and `Fan`.
- `src/ai` — the enemy AI, which aims through lanes (including bank shots) and obeys the same turn speed.
- `src/levels` — campaign and skirmish board data.
- `src/config` — palette, layout, and tuning. `src/render` — crisp high-DPI scaling. `src/ui` — buttons and stars.

## Roadmap

- **Discord Activity.** Embed the build with the Discord Embedded App SDK (auth, activity instance, iframe sizing).
- **Multiplayer.** Share cannon ownership and shots between players, possibly with Colyseus.
