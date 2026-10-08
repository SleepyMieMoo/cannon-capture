/** Input types that take text (a key press there is typing, not a shortcut). */
const NOT_TEXT = new Set(['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'color', 'file', 'image'])

/** Is this element (usually document.activeElement) a place where keys type text? Shortcuts skip those. */
export function isTypingTarget(el: { tagName?: string; type?: string; isContentEditable?: boolean } | null | undefined): boolean {
  if (!el) return false
  const tag = (el.tagName ?? '').toUpperCase()
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') return !NOT_TEXT.has((el.type ?? 'text').toLowerCase())
  return el.isContentEditable === true
}
