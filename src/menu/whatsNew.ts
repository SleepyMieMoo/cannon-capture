import data from '../data/whatsNew.json'

/** One line of What's new (src/data/whatsNew.json). */
export interface WhatsNewEntry {
  kind: 'new' | 'change' | 'fix'
  title: string
  text: string
}

export interface WhatsNewDay {
  /** YYYY-MM-DD */
  date: string
  entries: WhatsNewEntry[]
}

const KINDS = ['new', 'change', 'fix'] as const

/** Check the data file's shape; bad entries are left out (the view never breaks). */
export function parseWhatsNew(raw: unknown): WhatsNewDay[] {
  const days = (raw as { days?: unknown })?.days
  if (!Array.isArray(days)) return []
  const out: WhatsNewDay[] = []
  for (const d of days) {
    if (!d || typeof d.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d.date) || !Array.isArray(d.entries)) continue
    const entries = (d.entries as unknown[]).filter(
      (e): e is WhatsNewEntry =>
        !!e &&
        typeof e === 'object' &&
        (KINDS as readonly string[]).includes((e as WhatsNewEntry).kind) &&
        typeof (e as WhatsNewEntry).title === 'string' &&
        (e as WhatsNewEntry).title.length > 0 &&
        typeof (e as WhatsNewEntry).text === 'string',
    )
    if (entries.length) out.push({ date: d.date, entries })
  }
  return out
}

export const WHATS_NEW: WhatsNewDay[] = parseWhatsNew(data)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "8 Oct 2026" (no time zone games: it is a calendar date). */
export function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return `${d} ${MONTHS[m - 1] ?? '?'} ${y}`
}

export const KIND_LABEL: Record<WhatsNewEntry['kind'], string> = { new: 'New', change: 'Changed', fix: 'Fixed' }
