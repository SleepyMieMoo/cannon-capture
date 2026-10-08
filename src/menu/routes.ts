import type { AiLevel, LevelDef } from '../types'

/** Where a battle was started from (decides Back, Next and the in-battle menu). */
export type BattleFrom = 'editor' | 'maps' | 'menu' | 'puzzles'

/** A main-menu screen. */
export type MenuScreen = 'home' | 'play' | 'puzzles' | 'settings' | 'howto' | 'friends' | 'lobby'

/** A scene to go to, with its start data. */
export interface Route {
  scene: 'title' | 'map' | 'maps' | 'editor' | 'battle'
  data?: Record<string, unknown>
}

export interface BattleCtx {
  levelId: string
  /** Campaign position (-1 for custom maps and Skirmish). */
  levelIndex: number
  custom: boolean
  from?: BattleFrom
}

/** Back from a battle (end screen, in-battle menu, HUD). */
export function backRoute(ctx: BattleCtx): Route {
  if (ctx.from === 'editor') return { scene: 'editor', data: { resume: true } }
  if (ctx.from === 'maps') return { scene: 'maps' }
  if (ctx.from === 'menu') return { scene: 'title', data: { screen: 'play' } }
  if (ctx.from === 'puzzles') return { scene: 'title', data: { screen: 'puzzles' } }
  if (ctx.custom) return { scene: 'maps' }
  if (ctx.levelIndex >= 0) return { scene: 'map', data: { focus: ctx.levelId } }
  return { scene: 'title' }
}

/** The label for that Back (short: for the HUD). */
export function backLabel(ctx: BattleCtx, short: boolean): string {
  if (ctx.from === 'editor') return short ? 'Editor' : 'Back to editor'
  if (ctx.from === 'maps' || (ctx.custom && !ctx.from)) return 'My maps'
  if (ctx.from === 'menu') return short ? 'Change map' : 'Change map or difficulty'
  if (ctx.from === 'puzzles') return short ? 'Puzzles' : 'Back to puzzles'
  if (ctx.levelIndex >= 0) return short ? 'Map' : 'Back to map'
  return 'Main menu'
}

/** The main menu itself. */
export const MAIN_MENU: Route = { scene: 'title', data: { screen: 'home' } }

/** Screen stack for the main menu: Back (or Esc) goes up one level. */
export class MenuNav {
  private readonly stack: MenuScreen[] = ['home']

  constructor(start: MenuScreen = 'home') {
    if (start !== 'home') this.stack.push(start)
  }

  get screen(): MenuScreen {
    return this.stack[this.stack.length - 1]
  }

  get depth(): number {
    return this.stack.length
  }

  open(screen: MenuScreen): void {
    if (screen === this.screen) return
    if (screen === 'home') return this.home()
    this.stack.push(screen)
  }

  /** Up one screen. False when already on the home screen (nothing to go back to). */
  back(): boolean {
    if (this.stack.length <= 1) return false
    this.stack.pop()
    return true
  }

  home(): void {
    this.stack.length = 1
  }
}

/** A map you can play against the AI. */
export interface MapChoice {
  id: string
  name: string
  group: 'Built-in' | 'My maps'
  level: LevelDef
}

/** The level actually played: the map with the picked difficulty (hints and par are campaign-only). */
export function vsAiLevel(choice: MapChoice, difficulty: AiLevel): LevelDef {
  const { hint: _hint, par: _par, ...rest } = choice.level
  return { ...rest, kind: 'battle', ai: { difficulty } }
}
