import { DEFAULT_COLOUR, isTeamColour, type TeamColourId } from '../config/teamColours'

/** Your team colour, saved on this device. */
const KEY = 'cannon-capture:colour:v1'

export function parseColourPref(raw: string | null | undefined): TeamColourId {
  return isTeamColour(raw) ? raw : DEFAULT_COLOUR
}

export function loadColour(): TeamColourId {
  try {
    return parseColourPref(localStorage.getItem(KEY))
  } catch {
    return DEFAULT_COLOUR
  }
}

const listeners = new Set<(colour: TeamColourId) => void>()

/** Hear about a new pick (the title screen's demo round and the menu recolour themselves). Returns an unsubscribe. */
export function onColourChange(fn: (colour: TeamColourId) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function saveColour(colour: TeamColourId): void {
  try {
    localStorage.setItem(KEY, colour)
  } catch {
    // Private mode or storage full: the choice lasts until the page closes.
  }
  for (const fn of listeners) fn(colour)
}
