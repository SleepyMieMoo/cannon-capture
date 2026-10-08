/**
 * The rules behind the small "?" help buttons (see helpTip.ts), kept free of
 * the DOM so they can be tested:
 * - a mouse hovering the button (or the tip) shows it; leaving hides it, unless it was clicked;
 * - keyboard focus shows it; moving focus away hides it, unless it was clicked;
 * - a click or tap toggles it and keeps it open ("pinned") until a second tap,
 *   a tap anywhere else, or Esc;
 * - only one tip is open at a time: opening one closes the other.
 */
export type TipCause = 'hover' | 'focus' | 'pin'

export class TipRules<T> {
  /** The open tip, if any. */
  current: T | null = null
  private causes = new Set<TipCause>()

  constructor(private readonly show: (tip: T) => void, private readonly hide: (tip: T) => void) {}

  get pinned(): boolean {
    return this.current !== null && this.causes.has('pin')
  }

  isOpen(tip: T): boolean {
    return this.current === tip
  }

  private open(tip: T, cause: TipCause): void {
    if (this.current !== tip) {
      if (this.current !== null) this.hide(this.current)
      this.current = tip
      this.causes = new Set()
      this.show(tip)
    }
    this.causes.add(cause)
  }

  private drop(tip: T, cause: TipCause): void {
    if (this.current !== tip) return
    this.causes.delete(cause)
    if (this.causes.size === 0) this.close()
  }

  /** Close whatever is open. */
  close(): void {
    const tip = this.current
    if (tip === null) return
    this.current = null
    this.causes = new Set()
    this.hide(tip)
  }

  /** A mouse (or pen) over the button or the tip itself. Touch never hovers. */
  hoverIn(tip: T): void {
    this.open(tip, 'hover')
  }

  hoverOut(tip: T): void {
    this.drop(tip, 'hover')
  }

  /** Keyboard focus (a tap that focuses the button counts as the tap, not focus). */
  focus(tip: T): void {
    this.open(tip, 'focus')
  }

  blur(tip: T): void {
    this.drop(tip, 'focus')
  }

  /**
   * Click, tap, Enter or Space on the button. Open but not pinned (hovered or
   * focused): pin it, so it stays when the mouse leaves. Pinned: close it.
   */
  press(tip: T): void {
    if (this.current === tip && this.causes.has('pin')) this.close()
    else this.open(tip, 'pin')
  }

  /** A press somewhere that is neither the button nor its tip. */
  outside(): void {
    this.close()
  }

  /** Esc: true when it closed a tip (so nothing else should handle that Esc). */
  escape(): boolean {
    if (this.current === null) return false
    this.close()
    return true
  }
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface TipPlacement {
  x: number
  y: number
  /** Below or above the button. */
  side: 'below' | 'above'
  /** Where the little arrow points, from the tip's left edge. */
  arrowX: number
}

/**
 * Where a tip of size `tip` goes for a button at `anchor`, inside `view`
 * (the window, which is the whole Discord frame in an activity): below the
 * button unless it only fits above, then nudged left or right to stay inside.
 */
export function placeTip(anchor: Box, tip: { w: number; h: number }, view: { w: number; h: number }, gap = 8, margin = 8): TipPlacement {
  const below = view.h - (anchor.y + anchor.h) - gap - margin
  const above = anchor.y - gap - margin
  const side: TipPlacement['side'] = tip.h <= below || below >= above ? 'below' : 'above'
  let y = side === 'below' ? anchor.y + anchor.h + gap : anchor.y - gap - tip.h
  y = Math.max(margin, Math.min(y, view.h - margin - tip.h))
  const cx = anchor.x + anchor.w / 2
  const maxX = Math.max(margin, view.w - margin - tip.w)
  const x = Math.max(margin, Math.min(cx - tip.w / 2, maxX))
  const arrowX = Math.max(12, Math.min(cx - x, tip.w - 12))
  return { x, y, side, arrowX }
}
