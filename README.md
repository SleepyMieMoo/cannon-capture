# Cannon Capture

A small battle prototype by **SleepyMie**. Cannons sit on a board and fire on their own. Hit a cannon enough times and it flips to your colour and starts shooting for you. Walls block shots. A fan shoves them off course.

The look uses the colour themes from ChocoNeko, SleepyMie's studio ([`css/themes.css`](https://github.com/SleepyMieMoo/choconeko-site/blob/main/css/themes.css)). Only the colours are shared, with no ChocoNeko characters or story.

This pass is a standalone browser game: one skirmish against an AI. Puzzle levels and a Discord Activity build come later.

## How to play

You are gold. The enemy is strawberry pink. Warm grey cannons are neutral and do not fire until someone captures them.

1. Click one of your cannons.
2. Click the cannon you want it to shoot.
3. It keeps firing about once a second until you retarget it.

A cannon tints toward whoever is hitting it. At eight hits it flips. Shots from the other side contest that progress. Capture every cannon to win. Lose when none are yours.

The dashed gold line is your aim. Faint pink lines are the enemy's. The mint ring is a fan blowing downward — the top enemy shot bends off its line and into the lower neutral. P1 starts aimed into the tall wall, so retarget it. Restart from the corner, or press **R** on the end screen. **Esc** clears your selection.

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
