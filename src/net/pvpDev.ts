import type Phaser from 'phaser'
import { PVP } from '../config/pvp'
import { theme } from '../config/theme'
import { CAMPAIGN, SKIRMISH, findLevel } from '../levels'
import type { BattleData } from '../scenes/BattleScene'
import { joinRoom } from './pvp'
import { BroadcastTransport, randomId } from './transport'

/**
 * Player vs player test mode (Phase 0), only with ?pvpdev. Two tabs of the
 * same browser play each other over a BroadcastChannel: one hosts (runs the
 * round, plays gold), the other joins (plays pink). Nothing leaves the
 * browser and no server is involved.
 *
 *   ?pvpdev              a small panel: room, map, Host / Join / Split view
 *   ?pvpdev=split        both players side by side in one page (two frames)
 *   &role=host|join&room=abcd&map=skirmish   start straight away
 *   &gold=0              player 2 sees their cannons pink
 *   &lag=150&jitter=50   fake network delay (ms)
 */

/** Switches passed on to the frames / second window. */
const PASS = ['gold', 'lag', 'jitter', 'debug', 'perf']

function baseUrl(extra: Record<string, string>): string {
  const here = new URLSearchParams(location.search)
  const q = new URLSearchParams()
  q.set('pvpdev', '')
  for (const k of PASS) if (here.has(k)) q.set(k, here.get(k) ?? '')
  for (const [k, v] of Object.entries(extra)) q.set(k, v)
  return `${location.pathname}?${q.toString().replace(/=(?=&|$)/g, '')}`
}

const maps = () => [SKIRMISH, ...CAMPAIGN.filter((l) => l.kind !== 'puzzle')]

/** ?pvpdev=split: two frames, host on the left and player 2 on the right. Returns true if it took over the page. */
export function mountSplitView(): boolean {
  const params = new URLSearchParams(location.search)
  if (params.get('pvpdev') !== 'split') return false
  const room = params.get('room') || randomId().slice(0, 4)
  const map = params.get('map') || SKIRMISH.id
  document.body.style.cssText = `margin:0;background:${theme.bgCss};color:${theme.text};font:13px ${theme.font};overflow:hidden`
  document.getElementById('app')?.remove()
  const bar = document.createElement('div')
  bar.style.cssText = 'height:30px;display:flex;align-items:center;gap:16px;padding:0 12px;box-sizing:border-box'
  bar.innerHTML = `<b>PvP test · room ${room}</b><span>Left: host, plays gold</span><span>Right: player 2, plays pink${
    params.get('gold') === '0' ? '' : ' (sees itself as gold)'
  }</span><span style="opacity:.7">Click a side to play it. Nothing leaves this browser.</span>`
  const row = document.createElement('div')
  row.style.cssText = 'display:flex;height:calc(100vh - 30px)'
  for (const role of ['host', 'join']) {
    const f = document.createElement('iframe')
    f.title = role === 'host' ? 'Host (gold)' : 'Player 2 (pink)'
    f.src = baseUrl({ role, room, map })
    f.style.cssText = `flex:1;border:0;border-${role === 'host' ? 'right' : 'left'}:1px solid ${theme.textMuted};min-width:0`
    f.allow = 'autoplay'
    row.append(f)
  }
  document.body.append(bar, row)
  return true
}

/** ?pvpdev: the panel that starts a round as host or joins one. */
export function mountPvpPanel(game: Phaser.Game): void {
  if (!PVP.dev) return
  const params = new URLSearchParams(location.search)
  let transport: BroadcastTransport | null = null
  let cancelJoin: (() => void) | null = null

  const box = document.createElement('div')
  box.id = 'pvpdev'
  box.style.cssText = `position:fixed;left:8px;bottom:8px;z-index:50;background:${theme.bgCss};color:${theme.text};border:1px solid ${theme.textMuted};border-radius:8px;padding:8px 10px;font:12px ${theme.font};box-shadow:0 2px 10px #0006;max-width:300px`
  const toggle = document.createElement('button')
  toggle.textContent = 'PvP test ▾'
  toggle.style.cssText = 'all:unset;cursor:pointer;font-weight:bold'
  const body = document.createElement('div')
  body.style.cssText = 'display:grid;gap:6px;margin-top:6px'
  const room = document.createElement('input')
  room.value = params.get('room') || randomId().slice(0, 4)
  room.maxLength = 16
  room.style.cssText = 'width:80px'
  room.setAttribute('aria-label', 'Room code')
  const map = document.createElement('select')
  map.setAttribute('aria-label', 'Map')
  for (const l of maps()) map.append(new Option(l.name ?? l.id, l.id))
  map.value = findLevel(params.get('map'))?.id ?? SKIRMISH.id
  const status = document.createElement('div')
  status.style.opacity = '0.8'
  const btn = (label: string, run: () => void) => {
    const b = document.createElement('button')
    b.textContent = label
    b.onclick = run
    return b
  }
  const line = (...els: (HTMLElement | string)[]) => {
    const d = document.createElement('div')
    d.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap'
    d.append(...els)
    return d
  }
  const setOpen = (open: boolean) => {
    body.style.display = open ? 'grid' : 'none'
    toggle.textContent = open ? 'PvP test ▾' : 'PvP test ▸'
  }
  toggle.onclick = () => setOpen(body.style.display === 'none')

  const hangUp = () => {
    cancelJoin?.()
    cancelJoin = null
    transport?.close()
    transport = null
  }
  const code = () => room.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '') || 'test'
  const startBattle = (data: BattleData) => {
    for (const s of game.scene.getScenes(true)) if (s.scene.key !== 'battle') game.scene.stop(s.scene.key)
    game.scene.start('battle', data)
    setOpen(false)
  }
  const host = () => {
    hangUp()
    const r = code()
    transport = new BroadcastTransport(r, PVP.lagMs, PVP.jitterMs)
    status.textContent = `Hosting room ${r}: open Join in another tab (keep both visible).`
    startBattle({ levelId: map.value, from: 'menu', pvp: { role: 'host', room: r, transport } })
  }
  const join = () => {
    hangUp()
    const r = code()
    const t = new BroadcastTransport(r, PVP.lagMs, PVP.jitterMs)
    transport = t
    status.textContent = `Looking for the host of room ${r}…`
    cancelJoin = joinRoom(
      t,
      (start) => {
        cancelJoin = null
        status.textContent = `Playing pink in room ${r}.`
        startBattle({ from: 'menu', pvp: { role: 'client', room: r, transport: t, start } })
      },
      () => (status.textContent = `Room ${r} already has two players.`),
    )
  }
  // Its own window (not a tab), so both can stay in sight: a browser stops drawing a tab that is out of sight.
  const secondWindow = () => {
    window.open(baseUrl({ role: 'join', room: code() }), `cc-pvp-${code()}`, 'popup,width=960,height=600')
  }
  const split = () => {
    location.href = baseUrl({ pvpdev: 'split', room: code(), map: map.value })
  }
  body.append(
    line('Room', room, 'Map', map),
    line(btn('Host (gold)', host), btn('Join (pink)', join)),
    line(btn('Open player 2 window', secondWindow), btn('Split view', split)),
    status,
  )
  box.append(toggle, body)
  document.body.append(box)
  ;(window as unknown as { __pvpdev?: unknown }).__pvpdev = { host, join, room }

  const role = params.get('role')
  setOpen(!role)
  if (role === 'host' || role === 'join') {
    const go = () => (role === 'host' ? host() : join())
    // Wait for the title screen to be up (it loads sounds first), or it would open over the round.
    const t0 = Date.now()
    const wait = setInterval(() => {
      if (game.scene.isActive('title') || game.scene.isActive('battle') || Date.now() - t0 > 20000) {
        clearInterval(wait)
        go()
      }
    }, 50)
  }
}
