import type { MusicPlayer, MusicStatus } from '../audio/music'
import { TRACKS } from '../audio/musicTracks'
import { ICONS } from '../menu/art'
import { injectMenuStyles } from '../menu/menuStyles'
import { h } from './dom'

const icon = (svg: string): HTMLSpanElement => h('span.ic', { innerHTML: svg })

/** The line under the controls: what the player is waiting for, if anything. */
export function statusText(status: MusicStatus): string {
  switch (status) {
    case 'no-audio':
      return 'This browser can’t play music.'
    case 'missing':
      return 'Couldn’t load this song. Pick another, or check your connection.'
    case 'locked':
      return 'Click, tap or press any key to start the music.'
    case 'loading':
      return 'Loading…'
    case 'off':
      return 'Paused.'
    default:
      return 'Playing on a loop, from the menu into every battle.'
  }
}

/**
 * The jukebox panel: what's playing, previous / play-pause / next, the song
 * list (click a song to play it now, the star makes it the default), and the
 * music volume. Used by the main menu's Jukebox page and the in-battle Menu.
 * Updates in place when the player changes (never re-renders, so focus stays
 * put); call destroy() when it goes away.
 */
export function jukeboxPanel(player: MusicPlayer, opts: { compact?: boolean } = {}): { el: HTMLElement; destroy(): void } {
  injectMenuStyles()
  const title = h('div.jb-title')
  const artist = h('div.jb-artist')
  const eq = h('span.jb-eq', { 'aria-hidden': 'true' }, h('i'), h('i'), h('i'))
  const ctrl = (id: string, label: string, svg: string, run: () => void, cls = ''): HTMLButtonElement => {
    const b = h(`button.jb-btn${cls}`, { type: 'button', title: label, 'aria-label': label, dataset: { id } }, icon(svg))
    b.addEventListener('click', run)
    return b
  }
  const prev = ctrl('jb-prev', 'Previous song', ICONS.prev, () => player.prev())
  const playBtn = ctrl('jb-play', 'Play', ICONS.play, () => player.toggle(), '.main')
  playBtn.dataset.autofocus = ''
  const next = ctrl('jb-next', 'Next song', ICONS.next, () => player.next())
  const status = h('div.jb-status', { role: 'status', 'aria-live': 'polite' })

  const rows = TRACKS.map((t, i) => {
    const pick = h('button.jb-track', { type: 'button', dataset: { id: 'jb-track-' + t.id }, title: `Play ${t.title} now` },
      h('span.jb-num', {}, String(i + 1)),
      h('span.jb-name', {}, h('b', {}, t.short), h('small', {}, t.theme ? 'Title song' : t.artist)),
    )
    pick.addEventListener('click', () => {
      // The song you're on just carries on (or resumes); another one starts now.
      if (player.current !== t.id) player.select(t.id)
      if (!player.playing) player.play()
    })
    const star = h('button.jb-def', { type: 'button', dataset: { id: 'jb-default-' + t.id } })
    star.addEventListener('click', () => player.setDefault(t.id))
    return { t, pick, star, row: h('div.jb-row', {}, pick, star) }
  })

  const val = h('span.mm-val')
  const range = h('input.mm-range', { type: 'range', min: '0', max: '100', step: '5', id: 'jb-volume', dataset: { id: 'jb-volume' }, 'aria-label': 'Music volume' })
  range.addEventListener('input', () => player.setVolume(Number(range.value) / 100))

  const el = h(opts.compact ? 'div.jb.compact' : 'div.jb', { role: 'group', 'aria-label': 'Jukebox' },
    h('div.jb-now', {},
      h('div.jb-disc', {}, icon(ICONS.music), eq),
      h('div.jb-meta', {}, h('div.jb-label', {}, 'Now playing'), title, artist),
    ),
    h('div.jb-ctrl', {}, prev, playBtn, next),
    status,
    h('div.mm-h', {}, 'Songs'),
    h('div.jb-list', {}, ...rows.map((r) => r.row)),
    h('div.mm-row.jb-vol', {}, h('label', { htmlFor: 'jb-volume' }, 'Music volume'), range, val),
    h('div.mm-note', {}, opts.compact ? 'The star picks the song the game starts with.' : 'The star picks the song the game starts with. Music has its own volume; sound effects keep theirs (Settings, or N in a battle).'),
  )

  let lastVol = -1
  const update = (): void => {
    const st = player.status
    const t = player.track
    title.textContent = t.title
    artist.textContent = `${t.artist} · Pixabay`
    const on = player.playing
    el.classList.toggle('on', st === 'playing')
    playBtn.replaceChildren(icon(on ? ICONS.pause : ICONS.play))
    playBtn.title = on ? 'Pause' : 'Play'
    playBtn.setAttribute('aria-label', on ? 'Pause music' : 'Play music')
    playBtn.setAttribute('aria-pressed', String(on))
    status.textContent = statusText(st)
    status.dataset.status = st
    for (const r of rows) {
      const cur = r.t.id === player.current
      r.pick.setAttribute('aria-pressed', String(cur))
      r.pick.classList.toggle('missing', player.isMissing(r.t.id))
      const def = r.t.id === player.settings.track
      r.star.setAttribute('aria-pressed', String(def))
      r.star.replaceChildren(icon(def ? ICONS.starOn : ICONS.star))
      r.star.title = def ? `${r.t.short} is the default song` : `Make ${r.t.short} the default song`
      r.star.setAttribute('aria-label', r.star.title)
    }
    const v = Math.round(player.settings.volume * 100)
    if (v !== lastVol) {
      lastVol = v
      if (document.activeElement !== range) range.value = String(v)
      val.textContent = `${v}%`
    }
  }
  update()
  const off = player.onChange(update)
  return { el, destroy: off }
}
