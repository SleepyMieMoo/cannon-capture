import type { SideSkins } from './skins'
import { COMFORTABLE, COMPAT, compatible, type SideColours } from './teamColours'

/**
 * Online, both players always wear their own team colour and skin, so two
 * players can pick looks that are hard to tell apart. When they do, small
 * name tags go on every owned cannon (render/nameTags.ts).
 *
 * A clash is:
 * - the two colours fail the compatibility matrix (same colour, Sky with
 *   Blueberry, ...), whatever the skins; or
 * - the two wear the same skin and their colours only just pass (below
 *   COMFORTABLE: Gold/Tangerine, Strawberry/Peach, Tangerine/Sky, Sky/Grape).
 *   Different shapes are a second cue; with the same shape colour is the only
 *   one, so it has to be comfortably apart.
 *
 * The rings (light = yours, red = theirs) always tell owners apart; the tags
 * are for when the bodies don't.
 */
export function looksClash(colours: SideColours, skins: Pick<SideSkins, 'player' | 'enemy'>): boolean {
  if (!compatible(colours.player, colours.enemy)) return true
  return skins.player === skins.enemy && COMPAT[colours.player][colours.enemy] < COMFORTABLE
}
