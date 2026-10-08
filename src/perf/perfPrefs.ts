/** Whether the performance overlay is shown: remembered on this device, forced on by ?perf. */
const KEY = 'cannon-capture:perf:v1'

export function loadPerfShown(search: string): boolean {
  if (new URLSearchParams(search).has('perf')) return true
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY)
    return raw ? JSON.parse(raw)?.show === true : false
  } catch {
    return false
  }
}

export function savePerfShown(show: boolean): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ show }))
  } catch {
    // Storage blocked (private mode, sandboxed frame): the toggle still works for this visit.
  }
}

/** F3, or the backtick key (` left of 1) for keyboards where F-keys need Fn. Not while typing. */
export function isPerfKey(e: Pick<KeyboardEvent, 'code' | 'key' | 'ctrlKey' | 'altKey' | 'metaKey' | 'repeat'>, typing: boolean): boolean {
  if (typing || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return false
  return e.code === 'F3' || e.key === 'F3' || e.code === 'Backquote'
}
