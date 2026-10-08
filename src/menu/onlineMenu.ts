import { SKIN_LABEL } from '../config/skins'
import { loadSkin } from './skinPref'
import { loadColour } from './colourPref'
import { TEAM_COLOUR } from '../config/teamColours'
import { PVP_RULES } from '../config/pvpRules'
import { drawThumb } from '../editor/thumb'
import { MAP_SIZES } from '../levels/board'
import { COUNTDOWN_CHOICES, DEFAULT_SETTINGS, PVP_MAPS, cleanName, normaliseCode, isRoomCode, pvpLevel, type RoomInfo, type RoomSettings, type SeatInfo } from '../net/online'
import type { OnlineRoom } from '../net/onlineClient'
import { h } from '../ui/overlay'
import { ICONS } from './art'

/** What the online screens ask the game for (the menu itself never opens sockets). */
export interface OnlineMenu {
  room(): OnlineRoom | null
  name(): string
  setName(name: string): void
  /** New room on the server, then join it. */
  create(name: string): Promise<OnlineRoom>
  join(code: string, name: string): OnlineRoom
  leave(): void
  inviteLink(code: string): string
  /** A match is running in the room: go (back) to it. */
  toMatch(): void
}

/** The bits of MainMenu the screens use. */
export interface MenuKit {
  button(id: string, label: string, onClick: () => void, opts?: { icon?: string; cls?: string; autofocus?: boolean }): HTMLButtonElement
  screenFrame(title: string, sub: string, body: (Node | null)[], footer?: HTMLElement): HTMLElement
  open(screen: 'lobby' | 'friends', from?: string): void
  back(): boolean
  /** Run on the next render or when the menu goes. */
  onTeardown(fn: () => void): void
}

const mins = (ms: number): string => `${Math.round(ms / 60000)}-minute`

/** The online rules in one paragraph, for these match settings (the defaults on the Play with friends screen). */
export function rulesLine(s: RoomSettings = DEFAULT_SETTINGS): string {
  return (
    `${mins(PVP_RULES.matchMs)} matches: take every cannon, or hold the most when time runs out. ` +
    (s.countdown > 0 ? `A ${s.countdown}-second countdown first. ` : 'No countdown: firing starts at once. ') +
    (s.pauses ? `${PVP_RULES.pausesPerPlayer} pauses each, up to ${PVP_RULES.pauseMaxMs / 1000} s. ` : 'No pauses. ') +
    `Drop out for more than ${PVP_RULES.graceMs / 1000} s and an AI plays your side. Sides swap every rematch. You always wear your own colour and skin with the light rings; if your looks are too alike, names appear on the cannons. ` +
    'Your side of the board glows in your colour.'
  )
}

export const RULES_LINE = rulesLine() + ' The host can change the countdown, pauses and sides in the room.'

const COUNTDOWN_LABEL: Record<number, string> = { 0: 'Chaotic rush', 3: 'Standard', 5: 'Relaxed' }

/**
 * The host's match settings: countdown, pauses, sides. The host edits them
 * between matches; the guest and watchers see the same, read-only. Each
 * change goes to the server, which sends the room back to everyone.
 */
function settingsBlock(room: OnlineRoom, r: RoomInfo): HTMLElement[] {
  const s = r.settings
  // An older server has no settings: say what it plays.
  if (!s) return [h('div.mm-h', {}, 'Match settings'), h('div.mm-note', {}, 'This room’s server plays a 3-second countdown, 3 pauses each, host on the left.')]
  const edit = r.you.host && r.phase !== 'playing'
  const segs = COUNTDOWN_CHOICES.map((c) => {
    const b = h('button.mm-seg', { type: 'button', dataset: { id: 'countdown-' + c }, 'aria-pressed': String(c === s.countdown), disabled: !edit },
      h('span', {}, c === 0 ? '0 s' : `${c} s`), h('small', {}, COUNTDOWN_LABEL[c] ?? ''))
    b.addEventListener('click', () => room.send({ t: 'settings', countdown: c }))
    return b
  })
  const sw = h('input.mm-switch', { type: 'checkbox', role: 'switch', checked: !s.pauses, id: 'mm-nopause', disabled: !edit, dataset: { id: 'nopause' } }) as HTMLInputElement
  sw.addEventListener('change', () => room.send({ t: 'settings', pauses: !sw.checked }))
  const left = r.left ?? r.host ?? 0
  const who = (seat: 0 | 1): string => {
    const name = r.seats[seat]?.name ?? 'open seat'
    const tags = [seat === r.you.seat ? 'you' : '', seat === r.host ? 'host' : ''].filter(Boolean).join(', ')
    return tags ? `${name} (${tags})` : name
  }
  const swap = h('button.mm-btn', { type: 'button', dataset: { id: 'swap' }, disabled: !edit }, 'Swap sides')
  swap.addEventListener('click', () => room.send({ t: 'swap' }))
  const afterMatch = r.match > 0 ? ' Rematches swap sides from here.' : ' Each rematch then swaps.'
  return [
    h('div.mm-h', { style: 'margin-top:14px' }, edit ? 'Match settings' : 'Match settings (the host sets these)'),
    h('div.mm-sub', {}, 'Countdown'),
    h('div.mm-segs.mm-segs3', {}, ...segs),
    h('div.mm-row', {}, sw, h('label', { htmlFor: 'mm-nopause' }, 'Disable pauses')),
    h('div.mm-note', {}, s.pauses ? `Pauses on: ${PVP_RULES.pausesPerPlayer} each, up to ${PVP_RULES.pauseMaxMs / 1000} s.` : 'Pauses off: no Pause button, and Space does nothing.'),
    h('div.mm-sub', {}, 'Sides'),
    h('div.mm-sides', { dataset: { id: 'sides' } },
      h('div', {}, h('small', {}, 'Left'), h('b', {}, who(left))),
      h('div', {}, h('small', {}, 'Right'), h('b', {}, who(left === 0 ? 1 : 0))),
    ),
    h('div.mm-row', {}, edit ? swap : null, h('span.mm-note', {}, (r.match > 0 ? 'Next match.' : 'First match.') + afterMatch)),
  ]
}

export function friendsScreen(kit: MenuKit, online: OnlineMenu): HTMLElement {
  const err = h('div.mm-err', { role: 'status' })
  const name = h('input.mm-input', { id: 'mm-name', type: 'text', maxLength: 16, placeholder: 'Your name (optional)', value: online.name(), autocomplete: 'nickname', dataset: { id: 'name' } }) as HTMLInputElement
  const nameNow = (): string => {
    // Empty is fine: the room calls you Player 1 or Player 2.
    const n = cleanName(name.value, '')
    online.setName(n)
    return n
  }
  name.addEventListener('change', nameNow)
  const create = kit.button('create', 'Create a room', () => {
    create.disabled = true
    create.lastChild!.textContent = 'Creating…'
    err.textContent = ''
    online
      .create(nameNow())
      .then(() => kit.open('lobby', 'create'))
      .catch((e: unknown) => {
        create.disabled = false
        create.lastChild!.textContent = 'Create a room'
        err.textContent = `Could not reach the game server (${e instanceof Error ? e.message : String(e)}). Try again in a moment.`
      })
  }, { icon: ICONS.friends, cls: 'big.primary', autofocus: true })
  const code = h('input.mm-input.mm-code-in', { id: 'mm-code', type: 'text', maxLength: 4, placeholder: 'ABCD', autocomplete: 'off', spellcheck: false, dataset: { id: 'code' }, 'aria-label': 'Room code' }) as HTMLInputElement
  const join = (): void => {
    const c = normaliseCode(code.value)
    if (!isRoomCode(c)) {
      err.textContent = 'A room code is 4 letters, like KQTW.'
      return
    }
    online.join(c, nameNow())
    kit.open('lobby', 'join')
  }
  code.addEventListener('input', () => {
    code.value = code.value.toUpperCase().replace(/[^A-Z]/g, '')
  })
  code.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') join()
  })
  return kit.screenFrame('Play with friends', 'Online, one against one', [
    h('div.mm-friends', {},
      h('div.mm-side', {},
        h('label.mm-h', { htmlFor: 'mm-name' }, 'Your name'),
        name,
        h('div.mm-note', {}, 'Shown in the room, and on your cannons if your looks clash with your friend’s.'),
        h('div.mm-h', {}, 'New room'),
        create,
        h('div.mm-note', {}, 'You get a 4-letter code and a link to send to a friend.'),
        h('div.mm-note', { dataset: { id: 'skin-note' } }, `Your cannons wear ${SKIN_LABEL[loadSkin()]} in ${TEAM_COLOUR[loadColour()].label} (change them in Settings before you join).`),
      ),
      h('div.mm-side', {},
        h('label.mm-h', { htmlFor: 'mm-code' }, 'Join a room'),
        h('div.mm-row', {}, code, kit.button('join', 'Join', join, { icon: ICONS.play })),
        h('div.mm-note', {}, 'Anyone who joins after the two players watches.'),
      ),
    ),
    err,
    h('div.mm-note.mm-rules', {}, RULES_LINE),
  ])
}

function seatCard(seat: 0 | 1, info: SeatInfo | null, room: OnlineRoom): HTMLElement {
  const r = room.info!
  const you = r.you.seat === seat
  const tags: string[] = []
  if (you) tags.push('you')
  if (r.host === seat) tags.push('host')
  const state = !info ? 'Waiting for a friend…' : info.ai ? 'AI is playing' : info.connected ? 'Here' : 'Reconnecting…'
  return h(`div.mm-seat${info ? '' : '.empty'}${you ? '.you' : ''}`, { dataset: { id: `seat-${seat}` } },
    h('div.n', {}, info ? info.name : 'Open seat'),
    h('div.m', {}, h('span', {}, tags.join(' · ')), h('span', { className: info?.connected ? 'ok' : 'wait' }, state)),
  )
}

export function lobbyScreen(kit: MenuKit, online: OnlineMenu): HTMLElement {
  const room = online.room()
  if (!room) {
    return kit.screenFrame('Room', '', [h('div.mm-note', {}, 'You are not in a room.'), kit.button('friends', 'Play with friends', () => kit.open('friends'), { autofocus: true })])
  }
  const r = room.info
  const status = h('span', { id: 'mm-ping' })
  const showStatus = (): void => {
    status.textContent =
      room.status === 'open' ? `Connected${room.rttAvg !== null ? ` · ${room.rttAvg} ms` : ''}` : room.status === 'reconnecting' ? 'Reconnecting…' : room.status === 'connecting' ? 'Connecting…' : 'Closed'
  }
  showStatus()
  const t = setInterval(showStatus, 1000)
  kit.onTeardown(() => clearInterval(t))
  const leave = kit.button('leave', 'Leave room', () => kit.back(), { cls: 'mm-back' })
  if (room.closed || !r) {
    const msg = room.closed ? room.error?.msg ?? 'The room closed.' : 'Joining room ' + room.code + '…'
    return kit.screenFrame(`Room ${room.code}`, '', [h('div.mm-note', { role: 'status' }, msg)], h('div.mm-bar', {}, leave))
  }
  const link = online.inviteLink(r.code)
  const copied = h('span.mm-note', { role: 'status' })
  const copy = kit.button('copy', 'Copy invite link', () => {
    const done = (ok: boolean): void => {
      copied.textContent = ok ? 'Copied!' : 'Copy it from the box above.'
    }
    navigator.clipboard?.writeText(link).then(() => done(true), () => done(false)) ?? done(false)
  })
  const linkBox = h('input.mm-input.mm-link', { type: 'text', readOnly: true, value: link, 'aria-label': 'Invite link', onfocus: (e: FocusEvent) => (e.target as HTMLInputElement).select() })
  const host = r.you.host
  const playing = r.phase === 'playing'
  const cards = PVP_MAPS.map((m) => {
    const canvas = h('canvas')
    drawThumb(canvas, pvpLevel(m), 168)
    const on = m.id === r.map
    const el = h(`button.mm-card${on ? '.on' : ''}`, { type: 'button', dataset: { id: 'map-' + m.id }, title: m.name, 'aria-pressed': String(on), disabled: !host || playing },
      canvas,
      h('div.n', {}, m.name),
      h('div.m', {}, h('span', {}, MAP_SIZES[m.size ?? 'small'].label), h('span', {}, on ? 'Picked' : '')),
    )
    el.addEventListener('click', () => room.send({ t: 'map', id: m.id }))
    return el
  })
  const both = r.seats[0]?.connected && r.seats[1]?.connected
  const mapName = PVP_MAPS.find((m) => m.id === r.map)?.name ?? r.map
  let action: HTMLElement
  if (playing) action = kit.button('tomatch', r.you.seat === null ? 'Watch the match' : 'Back to the match', () => online.toMatch(), { icon: ICONS.play, cls: 'big.primary', autofocus: true })
  else if (r.you.seat === null) action = h('div.mm-pick', {}, h('div.n', {}, 'Watching'), h('div.mm-note', {}, 'Both seats are taken: you will watch the match.'))
  else if (host) {
    const b = kit.button('start', both ? 'Start match' : 'Waiting for a friend…', () => room.send({ t: 'start' }), { icon: ICONS.play, cls: 'big.primary', autofocus: !!both })
    b.disabled = !both
    action = b
  } else action = h('div.mm-pick', {}, h('div.n', {}, 'Waiting for the host'), h('div.mm-note', {}, 'The host picks the map and starts the match.'))
  const err = room.error && room.error.code === 'notallowed' ? h('div.mm-err', { role: 'status' }, room.error.msg) : null
  const last = r.result
    ? h('div.mm-note', {}, `Last match: ${r.result.winner === null ? 'a draw' : `${r.seats[r.result.winner]?.name ?? 'someone'} won`} (${r.result.cannons[0]}–${r.result.cannons[1]} cannons).`)
    : null
  return kit.screenFrame(`Room ${r.code}`, '', [
    h('div.mm-play', {},
      h('div', {},
        h('div.mm-h', {}, host && !playing ? 'Pick the map' : 'Map'),
        h('div.mm-cards', {}, ...cards),
        ...settingsBlock(room, r),
        h('div.mm-note.mm-rules', {}, 'Fair maps only: both sides start the same. ' + rulesLine(r.settings)),
      ),
      h('div.mm-side', {},
        h('div.mm-h', {}, 'Invite code'),
        h('div.mm-bigcode', { dataset: { id: 'code' } }, r.code),
        linkBox,
        h('div.mm-row', {}, copy, copied),
        h('div.mm-h', {}, 'Players'),
        seatCard(0, r.seats[0], room),
        seatCard(1, r.seats[1], room),
        h('div.mm-note', {}, r.spectators ? `${r.spectators} watching` : 'Anyone else with the code can watch.'),
        last,
        err,
      ),
    ),
  ],
  h('div.mm-bar', {}, leave, h('div.mm-pick', {}, h('div.n', {}, mapName), h('div.mm-note', {}, status)), action),
  )
}
