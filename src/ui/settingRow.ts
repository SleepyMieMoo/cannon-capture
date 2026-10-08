import { h } from './dom'
import { helpTip } from './helpTip'

export interface SettingRowOpts {
  /** The setting's name, on the left. */
  label: string
  /** The id of the control the label is for (a click on the label works it). */
  for?: string
  /** The explanation, behind the "?" right after the label. */
  help?: string
  /** A short live line under the label ("Now: <song>"). */
  sub?: Node | string | null
  /** The control(s), on the right. */
  control?: (Node | null | false)[]
  /**
   * 'wide': a wide control (segmented buttons) that drops under the label
   * when the row is too narrow; 'block': always under the label (pickers).
   */
  layout?: 'wide' | 'block'
  /** data-row, for tests and screenshots. */
  id?: string
}

/**
 * One setting on one compact row: label + "?" on the left, the control on the
 * right. On narrow screens the label wraps before the control is squeezed;
 * wide controls drop under the label. The same row is used by Settings,
 * Profile, the room settings, the jukebox and the in-battle Settings panel.
 */
export function settingRow(o: SettingRowOpts): HTMLDivElement & { help?: HTMLSpanElement } {
  const text = o.for ? h('label.mm-srow-t', { htmlFor: o.for }, o.label) : h('span.mm-srow-t', {}, o.label)
  const tip = o.help ? helpTip(o.help, o.label) : null
  const left = h('div.mm-srow-l', {}, h('div.mm-srow-n', {}, text, tip), o.sub ? h('div.mm-srow-sub', {}, o.sub) : null)
  const row = h(`div.mm-srow${o.layout ? '.' + o.layout : ''}`, { dataset: o.id ? { row: o.id } : {} }, left, o.control ? h('div.mm-srow-c', {}, ...o.control) : null) as HTMLDivElement & { help?: HTMLSpanElement }
  if (tip) row.help = tip
  return row
}

/** A group header ("Sound") with an optional "?" right after it, for lists that are not one row. */
export function groupHead(label: string, help?: string, cls = 'mm-h'): HTMLDivElement & { help?: HTMLSpanElement } {
  const tip = help ? helpTip(help, label) : null
  const el = h(`div.${cls}.mm-hh`, {}, h('span', {}, label), tip) as HTMLDivElement & { help?: HTMLSpanElement }
  if (tip) el.help = tip
  return el
}
