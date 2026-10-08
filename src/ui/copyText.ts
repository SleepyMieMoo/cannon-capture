/** Clipboard API, then the old execCommand trick, else 'manual'. */
export async function copyText(text: string): Promise<'clipboard' | 'execCommand' | 'manual'> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return 'clipboard'
    }
  } catch {
    // Permissions policy or no user gesture: try the next way.
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    if (ok) return 'execCommand'
  } catch {
    // Fall through to manual.
  }
  return 'manual'
}
