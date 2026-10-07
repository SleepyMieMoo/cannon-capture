# Cannon Capture

A small battle prototype by **SleepyMie**. Cannons sit on a board and fire on their own. Hit a cannon enough times and it flips to your colour and starts shooting for you. Walls block shots. A fan shoves them off course.

The look uses the colour themes from ChocoNeko, SleepyMie's studio ([`css/themes.css`](https://github.com/SleepyMieMoo/choconeko-site/blob/main/css/themes.css)). Only the colours are shared, with no ChocoNeko characters or story.

This pass is a standalone browser game: one skirmish against an AI. Puzzle levels and a Discord Activity build come later.

## How to play

You are gold. The enemy is strawberry pink. Warm grey cannons are neutral and do not fire until someone captures them.

1. Click one of your cannons to select it (it gets a pulsing ring).
2. Click anywhere on the board to set that spot as its aim point, or click an enemy or neutral cannon to aim at it. Free aiming lets you lead shots, bank them off walls, or let a fan carry them.
3. Cannons don't snap. The barrel turns toward its aim at a limited speed, and the cannon keeps firing along wherever the barrel points right now (about once a second). Big swings cost you shots: it holds fire while the barrel is far off target.
4. Click the selected cannon again (or press **Esc**) to deselect. Click another of your cannons to switch to it.

A cannon tints toward whoever is hitting it. At eight hits it flips. Shots from the other side contest that progress. Capture every cannon to win. Lose when none are yours. A newly captured cannon swings toward the nearest foe on its own.

The enemy obeys the same turn speed. Your aim shows as a gold dashed line with a crosshair at free aim points; while a cannon is selected, a pale line previews where your next click would aim. Faint pink lines are the enemy's. The mint ring is a fan blowing downward. P1 starts aimed into the tall wall, so re-aim it. Restart from the corner, or press **R** on the end screen. Works with taps on touch screens too.

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

- `src/scenes` — Phaser scenes. `BattleScene` runs the skirmish.
- `src/entities` — `Cannon`, `Shot`, `Wall`, and `Fan`.
- `src/ai` — enemy retargeting.
- `src/sim` — capture, aiming, and shot physics, covered by `npm test`.
- `src/levels` — board data.
- `src/config` — palette, layout, and tuning.

## Roadmap

- **Puzzle levels.** Hand-built boards where the goal is to capture every cannon, with walls and fans as the puzzle. No opposing AI.
- **Discord Activity.** Embed the build with the Discord Embedded App SDK (auth, activity instance, iframe sizing).
- **Multiplayer.** Share cannon ownership and shots between players, possibly with Colyseus.
