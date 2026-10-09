import { SKIN_LABEL } from '../config/skins'
import { loadSkin } from './skinPref'
import { loadColour } from './colourPref'
import { TEAM_COLOUR } from '../config/teamColours'
import { PVP_RULES } from '../config/pvpRules'
import { drawThumb } from '../editor/thumb'
import { MAP_SIZES } from '../levels/board'
import { COUNTDOWN_CHOICES, DEFAULT_SETTINGS, PAUSE_COUNT_MAX, PAUSE_SECS_CHOICES, type PauseCount, PVP_MAPS, SERVER_REGIONS, cleanName, isServerRegion, normaliseCode, isRoomCode, pvpLevel, type RoomInfo, type RoomSettings, type SeatInfo, type ServerRegion } from '../net/online'
import type { OnlineRoom } from '../net/onlineClient'
import { h } from '../ui/overlay'
import { serverLine } from '../net/onlineView'
import { ICONS } from './art'
import { groupHead, settingRow } from '../ui/settingRow'

/** What the online screens ask the game for (the menu itself never opens sockets). */
export interface OnlineMenu {
  room(): OnlineRoom | null
  name(): string
  setName(name: string): void
  /** New room on the server (near you, or in `region`), then join it. */
  create(name: string, region?: ServerRegion | null): Promise<OnlineRoom>
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
    (s.pauses ? `${pauseRule(s)}. ` : 'No pauses. ') +
    `Drop out for more than ${PVP_RULES.graceMs / 1000} s and an AI plays your side. Sides swap every rematch. You always wear your own colour and skin with the light rings; if your looks are too alike, names appear on the cannons. ` +
    'Your side of the board glows in your colour.'
  )
}

export const RULES_LINE = rulesLine() + ' The host can change the countdown, pauses and sides in the room.'

/** "3 pauses each, up to 5 s" / "Unlimited pauses, until resumed". */
export function pauseRule(s: RoomSettings): string {
  const count = s.pauseCount === null ? 'Unlimited pauses' : `${s.pauseCount} pause${s.pauseCount === 1 ? '' : 's'} each`
  return `${count}, ${s.pauseLimit ? `up to ${s.pauseSecs} s` : 'until resumed'}`
}

/** The pauses-per-player stepper's order: 1 to 10, then Unlimited. */
const PAUSE_COUNTS: readonly PauseCount[] = [...Array.from({ length: PAUSE_COUNT_MAX }, (_, i) => i + 1), null]

const COUNTDOWN_LABEL: Record<number, string> = { 0: 'Chaotic rush', 3: 'Standard', 5: 'Relaxed' }

/**
 * The host's match settings: countdown, pauses, sides. The host edits them
 * between matches; the guest and watchers see the same, read-only. Each
 * change goes to the server, which sends the room back to everyone.
 */
function settingsBlock(room: OnlineRoom, r: RoomInfo): HTMLElement[] {
  const s = r.settings
  const rules = 'Fair maps only: both sides start the same. ' + rulesLine(s)
  // An older server has no settings: say what it plays.
  if (!s) return [groupHead('Match settings', rules), h('div.mm-note', {}, 'This room’s server plays a 3-second countdown, 3 pauses each up to 30 s, host on the left.')]
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
  const swap = h('button.mm-btn.small', { type: 'button', dataset: { id: 'swap' }, disabled: !edit }, 'Swap sides')
  swap.addEventListener('click', () => room.send({ t: 'swap' }))
  const afterMatch = r.match > 0 ? ' Rematches swap sides from here.' : ' Each rematch then swaps.'
  const pauses = pauseRule(s)
  const pauseEdit = edit && s.pauses
  // Pauses per player: − value +, 1 to 10 then Unlimited.
  const ci = Math.max(0, PAUSE_COUNTS.indexOf(s.pauseCount))
  const step = (d: number, id: string, label: string, sym: string) => {
    const j = ci + d
    const b = h('button.mm-step', { type: 'button', dataset: { id }, 'aria-label': label, title: label, disabled: !pauseEdit || j < 0 || j >= PAUSE_COUNTS.length }, sym)
    b.addEventListener('click', () => room.send({ t: 'settings', pauseCount: PAUSE_COUNTS[j] }))
    return b
  }
  const countVal = h('output.mm-step-v', { dataset: { id: 'pausecount' }, 'aria-live': 'polite' }, s.pauseCount === null ? 'Unlimited' : String(s.pauseCount))
  const stepper = h('div.mm-stepper', { role: 'group', 'aria-label': 'Pauses per player' }, step(-1, 'pausecount-minus', 'Fewer pauses', '−'), countVal, step(1, 'pausecount-plus', 'More pauses', '+'))
  // Pause time limit: on/off, then how long.
  const lim = h('input.mm-switch', { type: 'checkbox', role: 'switch', checked: s.pauseLimit, id: 'mm-pauselimit', disabled: !pauseEdit, dataset: { id: 'pauselimit' } }) as HTMLInputElement
  lim.addEventListener('change', () => room.send({ t: 'settings', pauseLimit: lim.checked }))
  const secs = PAUSE_SECS_CHOICES.map((c) => {
    const b = h('button.mm-seg', { type: 'button', dataset: { id: 'pausesecs-' + c }, 'aria-pressed': String(c === s.pauseSecs), disabled: !pauseEdit || !s.pauseLimit }, `${c} s`)
    b.addEventListener('click', () => room.send({ t: 'settings', pauseSecs: c }))
    return b
  })
  return [
    groupHead(edit ? 'Match settings' : 'Match settings (the host sets these)', rules),
    settingRow({
      id: 'countdown',
      label: 'Countdown',
      help: 'Time to aim and pick tower types before firing starts. 0 s: chaotic rush, 3 s: standard, 5 s: relaxed.',
      layout: 'wide',
      control: [h('div.mm-segs.mm-segs3', {}, ...segs)],
    }),
    settingRow({
      id: 'nopause',
      label: 'Disable pauses',
      for: 'mm-nopause',
      sub: s.pauses ? `Pauses on: ${pauses}.` : 'Pauses off.',
      help: 'Off: no Pause button, and Space does nothing. On: the two settings below say how many pauses each player gets and how long one lasts.',
      control: [sw],
    }),
    settingRow({
      id: 'pausecount',
      label: 'Pauses per player',
      sub: s.pauses ? (s.pauseCount === null ? 'As many as you like.' : `Each player, each match.`) : 'Pauses are off.',
      help: `How many times each player may pause in one match (1 to 10, or Unlimited). The Pause button shows how many you have left and greys out when they are used up. Even on Unlimited, ${PVP_RULES.pauseSpam.count} pauses within ${PVP_RULES.pauseSpam.windowMs / 1000} s lock that player's Pause for ${PVP_RULES.pauseSpam.lockoutMs / 1000} s.`,
      control: [stepper],
    }),
    settingRow({
      id: 'pauselimit',
      label: 'Pause time limit',
      for: 'mm-pauselimit',
      sub: !s.pauses ? 'Pauses are off.' : s.pauseLimit ? `A pause ends by itself after ${s.pauseSecs} s.` : 'A pause lasts until its player resumes.',
      help: `On: a pause ends by itself after the time you pick, with a countdown on both screens; whoever paused can still resume early. Off: it lasts until the player who paused resumes (at most ${PVP_RULES.pauseSafetyMs / 60_000} minutes, so nobody can hold a match forever).`,
      layout: 'wide',
      control: [lim, h('div.mm-segs.mm-segs5', { dataset: { id: 'pausesecs' } }, ...secs)],
    }),
    settingRow({
      id: 'sides',
      label: 'Sides',
      sub: (r.match > 0 ? 'Next match.' : 'First match.') + afterMatch,
      help: 'Who starts on the left and who on the right. The host can swap them before a match; each rematch swaps them anyway.',
      layout: 'block',
      control: [
        h('div.mm-sides-row', {},
          h('div.mm-sides', { dataset: { id: 'sides' } },
            h('div', {}, h('small', {}, 'Left'), h('b', {}, who(left))),
            h('div', {}, h('small', {}, 'Right'), h('b', {}, who(left === 0 ? 1 : 0))),
          ),
          edit ? swap : null,
        ),
      ],
    }),
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
      .create(nameNow(), isServerRegion(region.value) ? region.value : null)
      .then(() => kit.open('lobby', 'create'))
      .catch((e: unknown) => {
        create.disabled = false
        create.lastChild!.textContent = 'Create a room'
        err.textContent = `Could not reach the game server (${e instanceof Error ? e.message : String(e)}). Try again in a moment.`
      })
  }, { icon: ICONS.friends, cls: 'big.primary', autofocus: true })
  // Where the room runs: near you unless you pick (far-apart friends: somewhere between keeps it fair).
  const region = h('select.mm-input.mm-select', { id: 'mm-region', dataset: { id: 'region' }, 'aria-label': 'Server region' },
    h('option', { value: '' }, 'Near me (automatic)'),
    ...SERVER_REGIONS.filter((r) => !('pick' in r)).map((r) => h('option', { value: r.id }, r.label)),
  ) as HTMLSelectElement
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
        settingRow({
          id: 'region',
          label: 'Server',
          for: 'mm-region',
          help: 'A room runs near whoever creates it. Playing someone far away? Pick a region in between if there is one, or take turns hosting near each of you. The lobby shows where it landed.',
          layout: 'wide',
          control: [region],
        }),
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
  const where = r?.server ? h('div.mm-note', { dataset: { id: 'server' } }, serverLine(r.server, room.rttAvg)) : null
  const showStatus = (): void => {
    status.textContent =
      room.status === 'open' ? `Connected${room.rttAvg !== null ? ` · ${room.rttAvg} ms` : ''}` : room.status === 'reconnecting' ? 'Reconnecting…' : room.status === 'connecting' ? 'Connecting…' : 'Closed'
    if (where && r?.server) where.textContent = serverLine(r.server, room.rttAvg)
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
        where,
        last,
        err,
      ),
    ),
  ],
  h('div.mm-bar', {}, leave, h('div.mm-pick', {}, h('div.n', {}, mapName), h('div.mm-note', {}, status)), action),
  )
}
