/**
 * Target mode's dim: while you aim a cannon, the board darkens except the
 * cannons that matter (BattleScene.spotlight). Above the board, walls, shots
 * and other cannons (depth 5); below the lit cannons (6) and their lines.
 */
export const DIM = {
  depth: 5.5,
  /** How dark at full strength (Dark Choco's background colour). */
  alpha: 0.62,
  /** Fade in or out (ms). */
  fadeMs: 140,
  /** Past the board's edges, so a zoomed-out view is dimmed all over. */
  margin: 2000,
} as const

/** `from` moved toward `to` by at most `step` (both 0..1). */
export function moveToward(from: number, to: number, step: number): number {
  return from < to ? Math.min(to, from + step) : Math.max(to, from - step)
}

interface Lit {
  side: string
  target: unknown
}

/**
 * Who stays lit in target mode: the selected cannon, its current target, any
 * (non-neutral) cannon aiming at it, and the cannon under the pointer (the one
 * you would aim at). Null when nothing is selected: no dim.
 */
export function spotlightSet<C extends Lit>(selected: C | null, cannons: readonly C[], hover: C | null): Set<C> | null {
  if (!selected) return null
  const lit = new Set<C>([selected])
  if (selected.target) lit.add(selected.target as C)
  for (const c of cannons) if (c.target === selected && c.side !== 'neutral') lit.add(c)
  if (hover && hover !== selected) lit.add(hover)
  return lit
}
