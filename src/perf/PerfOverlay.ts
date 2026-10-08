import Phaser from 'phaser'
import { cssHex, theme } from '../config/theme'
import type { LevelDef } from '../types'
import { aiDifficulty } from '../ai/towerChoice'
import { discord } from '../platform/runtime'
import { loadPerfShown, isPerfKey, savePerfShown } from './perfPrefs'
import { avgMax, browserLabel, fpsLevel, fpsOf, frameLevel, perfReport, Series, summarize, type PerfLevel, type PerfSnapshot } from './perfStats'

/** Stats cover this much recent time; FPS itself uses the last second. */
const WINDOW_MS = 5000
const FPS_MS = 1000
const SPARK_MS = 4000
/** The panel's text refreshes this often (the measuring itself is per frame). */
const PAINT_MS = 250
/** Gaps longer than this are a hidden tab or a breakpoint, not a slow frame. */
const GAP_MS = 1000

declare const __BUILD_ID__: string
export const BUILD_ID: string = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev'

/** What a running battle shares with the overlay. */
export interface PerfBattle {
  level: LevelDef
  cannons: () => number
  shots: () => number
  sounds: () => number
}

const LEVEL_COLOUR: Record<PerfLevel, string> = { good: cssHex(theme.fan), ok: cssHex(theme.player), bad: cssHex(theme.enemy) }
const SCENE_NAMES: Record<string, string> = { title: 'Main menu', map: 'Levels', editor: 'Map editor', maps: 'My maps', battle: 'Battle' }

/**
 * The performance overlay: a small corner panel with FPS, frame times, sim /
 * AI / render timings and counts, plus a Copy button for a one-line report.
 * Toggle: Settings, F3 or backtick, or ?perf in the URL.
 *
 * While hidden it listens to nothing but that key; the battle's hot path only
 * checks `perf.active`. While shown it reads performance.now() a few times a
 * frame and repaints its text four times a second.
 */
export class PerfMonitor {
  /** Read on the hot path: measure only while true. */
  active = false
  battle: PerfBattle | null = null
  private game: Phaser.Game | null = null
  private readonly frames = new Series()
  private readonly logic = new Series()
  private readonly render = new Series()
  private readonly sim = new Series()
  private readonly ai = new Series()
  private readonly look = new Series()
  private lastStep = 0
  private tStep = 0
  private tPre = 0
  private lastPaint = 0
  private el: HTMLDivElement | null = null
  private readonly listeners = new Set<(on: boolean) => void>()
  private env: { platform: string; browser: string; renderer: string; gpu: string | null } | null = null
  /** Compact panel (chosen with More / Less); null until chosen, then small screens start compact. */
  private compact: boolean | null = null

  attach(game: Phaser.Game, search = window.location.search): void {
    this.game = game
    window.addEventListener('keydown', this.onKey, true)
    if (loadPerfShown(search)) this.setShown(true, false)
  }

  get shown(): boolean {
    return this.active
  }

  /** Show or hide; `save` remembers it on this device. */
  setShown(on: boolean, save = true): void {
    if (save) savePerfShown(on)
    if (on === this.active) return
    this.active = on
    const g = this.game
    if (on) {
      this.clear()
      this.build()
      g?.events.on(Phaser.Core.Events.PRE_STEP, this.onPreStep)
      g?.events.on(Phaser.Core.Events.PRE_RENDER, this.onPreRender)
      g?.events.on(Phaser.Core.Events.POST_RENDER, this.onPostRender)
    } else {
      g?.events.off(Phaser.Core.Events.PRE_STEP, this.onPreStep)
      g?.events.off(Phaser.Core.Events.PRE_RENDER, this.onPreRender)
      g?.events.off(Phaser.Core.Events.POST_RENDER, this.onPostRender)
      this.el?.remove()
      this.el = null
    }
    for (const fn of this.listeners) fn(on)
  }

  toggle(): void {
    this.setShown(!this.active)
  }

  /** Be told when it is shown or hidden (Settings switches). Returns an unsubscribe. */
  onChange(fn: (on: boolean) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** The battle's own timings for this frame (ms). Call only while `active`. */
  recordBattle(simMs: number, aiMs: number, lookMs: number): void {
    const now = performance.now()
    this.sim.push(now, simMs)
    this.ai.push(now, aiMs)
    this.look.push(now, lookMs)
  }

  snapshot(now = performance.now()): PerfSnapshot {
    const canvas = this.game?.canvas
    const rect = canvas?.getBoundingClientRect()
    const env = this.environment()
    const recent = (s: Series) => avgMax(s.since(now, WINDOW_MS))
    const b = this.battle
    return {
      build: BUILD_ID,
      ...env,
      canvas: {
        w: canvas?.width ?? 0,
        h: canvas?.height ?? 0,
        cssW: Math.round(rect?.width ?? 0),
        cssH: Math.round(rect?.height ?? 0),
        dpr: window.devicePixelRatio || 1,
      },
      fps: fpsOf(this.frames.since(now, FPS_MS)),
      frame: summarize(this.frames.since(now, WINDOW_MS)),
      logic: recent(this.logic),
      render: recent(this.render),
      sim: b ? recent(this.sim) : null,
      ai: b ? recent(this.ai) : null,
      look: b ? recent(this.look) : null,
      counts: b ? { cannons: b.cannons(), shots: b.shots(), sounds: b.sounds() } : null,
      context: this.context(),
    }
  }

  report(): string {
    return perfReport(this.snapshot())
  }

  private clear(): void {
    for (const s of [this.frames, this.logic, this.render, this.sim, this.ai, this.look]) s.clear()
    this.lastStep = 0
    this.lastPaint = 0
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (!isPerfKey(e, isTyping(document.activeElement))) return
    e.preventDefault()
    this.toggle()
  }

  private readonly onPreStep = (): void => {
    const now = performance.now()
    if (this.lastStep > 0) {
      const dt = now - this.lastStep
      if (dt < GAP_MS) this.frames.push(now, dt)
    }
    this.lastStep = now
    this.tStep = now
  }

  private readonly onPreRender = (): void => {
    this.tPre = performance.now()
    if (this.tStep > 0) this.logic.push(this.tPre, this.tPre - this.tStep)
  }

  private readonly onPostRender = (): void => {
    const now = performance.now()
    if (this.tPre > 0) this.render.push(now, now - this.tPre)
    if (now - this.lastPaint >= PAINT_MS) {
      this.lastPaint = now
      this.paint(now)
    }
  }

  private context(): string {
    const scenes = this.game?.scene.getScenes(true).map((s) => s.scene.key) ?? []
    const key = scenes.find((k) => k !== 'titlebg') ?? scenes[0] ?? '?'
    const b = this.battle
    if (key === 'battle' && b) {
      const ai = b.level.kind === 'puzzle' ? 'puzzle' : aiDifficulty(b.level)
      return `${b.level.name} (${b.level.size ?? 'small'}, ${ai})`
    }
    return SCENE_NAMES[key] ?? key
  }

  private environment(): { platform: string; browser: string; renderer: string; gpu: string | null } {
    if (this.env) return this.env
    const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches
    const platform = discord.inDiscord ? `Discord ${discord.launch?.platform ?? '?'} (${discord.status})` : `web ${touch ? 'touch' : 'desktop'}`
    let renderer = 'Canvas'
    let gpu: string | null = null
    const r = this.game?.renderer
    if (r && r.type === Phaser.WEBGL) {
      const gl = (r as Phaser.Renderer.WebGL.WebGLRenderer).gl
      renderer = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext ? 'WebGL2' : 'WebGL'
      try {
        const ext = gl.getExtension('WEBGL_debug_renderer_info')
        gpu = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '') || null
      } catch {
        gpu = null
      }
    }
    const env = { platform, browser: browserLabel(navigator.userAgent), renderer, gpu }
    // Discord's status can still change (late READY), so only cache once it is final.
    if (!discord.inDiscord || discord.status !== 'connecting') this.env = env
    return env
  }

  // ----- DOM -----

  private q<T extends HTMLElement>(cls: string): T {
    return this.el!.querySelector(`.${cls}`) as T
  }

  private build(): void {
    injectStyles()
    const el = document.createElement('div')
    el.className = 'pf'
    el.setAttribute('role', 'status')
    el.setAttribute('aria-label', 'Performance')
    el.innerHTML = `
      <div class="pf-top"><span class="pf-fps">--</span><span class="pf-unit">FPS</span><span class="pf-ctx"></span>
        <button type="button" class="pf-btn pf-more" title="Show more or fewer numbers"></button>
        <button type="button" class="pf-btn pf-copy" title="Copy a one-line report for bug reports">Copy</button>
        <button type="button" class="pf-btn pf-x" title="Hide (F3)" aria-label="Hide performance">×</button></div>
      <div class="pf-row pf-frame"></div>
      <canvas class="pf-spark" width="276" height="30" aria-hidden="true"></canvas>
      <div class="pf-row pf-sim"></div>
      <div class="pf-row pf-gfx"></div>
      <div class="pf-row pf-count"></div>
      <div class="pf-row pf-env"></div>
      <textarea class="pf-manual" readonly hidden rows="3"></textarea>
      <div class="pf-msg" aria-live="polite"></div>`
    // Small screens start compact (FPS, frame times, graph); More shows the rest. Copy always has everything.
    const more = el.querySelector<HTMLButtonElement>('.pf-more')!
    const setCompact = (on: boolean) => {
      el.classList.toggle('pf-compact', on)
      more.textContent = on ? 'More' : 'Less'
    }
    setCompact(this.compact ?? (window.innerWidth <= 480 || window.innerHeight <= 420))
    more.addEventListener('click', () => {
      this.compact = !el.classList.contains('pf-compact')
      setCompact(this.compact)
    })
    el.querySelector('.pf-copy')!.addEventListener('click', () => void this.copy())
    // The manual-copy box goes away once you click elsewhere, so it never keeps the game's keys.
    const manual = el.querySelector<HTMLTextAreaElement>('.pf-manual')!
    manual.addEventListener('blur', () => (manual.hidden = true))
    el.querySelector('.pf-x')!.addEventListener('click', () => this.setShown(false))
    document.body.appendChild(el)
    this.el = el
    this.paint(performance.now())
  }

  private paint(now: number): void {
    if (!this.el) return
    const s = this.snapshot(now)
    const f = s.frame
    const fpsEl = this.q('pf-fps')
    fpsEl.textContent = f ? s.fps.toFixed(0) : '--'
    fpsEl.style.color = LEVEL_COLOUR[fpsLevel(s.fps)]
    this.q('pf-ctx').textContent = s.context
    const fr = this.q('pf-frame')
    fr.innerHTML = f
      ? `frame <b>${num(f.avg)}</b> avg · 1% low <b style="color:${LEVEL_COLOUR[frameLevel(f.low1)]}">${num(f.low1)}</b> · worst <b style="color:${LEVEL_COLOUR[frameLevel(f.worst)]}">${num(f.worst)}</b> ms`
      : 'frame: measuring…'
    const am = (x: { avg: number; max: number } | null) => (x ? `${num(x.avg)}<i>/${num(x.max)}</i>` : '–')
    this.q('pf-sim').innerHTML = s.sim ? `sim ${am(s.sim)} · AI ${am(s.ai)} · look-ahead ${am(s.look)} ms` : 'sim – (no battle running)'
    this.q('pf-gfx').innerHTML = `update ${am(s.logic)} · render ${am(s.render)} ms`
    const n = (k: number, word: string) => `${k} ${word}${k === 1 ? '' : 's'}`
    this.q('pf-count').textContent = s.counts ? `${n(s.counts.cannons, 'cannon')} · ${n(s.counts.shots, 'shot')} · ${n(s.counts.sounds, 'sound')}` : '–'
    this.q('pf-env').textContent = `${s.canvas.w}×${s.canvas.h} @${+s.canvas.dpr.toFixed(2)}x · ${s.renderer} · ${s.platform} · ${s.build}`
    this.q('pf-env').title = [s.gpu, s.browser].filter(Boolean).join(' · ')
    this.spark(now)
  }

  private spark(now: number): void {
    const c = this.q<HTMLCanvasElement>('pf-spark')
    const dpr = Math.min(3, window.devicePixelRatio || 1)
    const cssW = c.clientWidth || 220
    const cssH = c.clientHeight || 30
    if (c.width !== Math.round(cssW * dpr)) {
      c.width = Math.round(cssW * dpr)
      c.height = Math.round(cssH * dpr)
    }
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssW, cssH)
    const v = this.frames.since(now, SPARK_MS)
    // Scale: 50 ms at the top edge, stretched when frames are slower so the shape still shows.
    let worst = 0
    for (const ms of v) if (ms > worst) worst = ms
    const top = worst <= 50 ? 50 : worst <= 100 ? 100 : 250
    const y = (ms: number) => cssH - (Math.min(ms, top) / top) * cssH
    ctx.fillStyle = 'rgba(255,255,255,0.12)'
    for (const ms of [1000 / 60, 1000 / 30]) ctx.fillRect(0, Math.round(y(ms)), cssW, 1)
    const n = Math.min(v.length, cssW)
    const w = cssW / Math.max(n, 1)
    for (let i = 0; i < n; i++) {
      const ms = v[v.length - n + i]
      ctx.fillStyle = LEVEL_COLOUR[frameLevel(ms)]
      const yy = y(ms)
      ctx.fillRect(i * w, yy, Math.max(1, w - 0.2), cssH - yy)
    }
    ctx.fillStyle = 'rgba(255,255,255,0.55)'
    ctx.font = '8px ui-monospace, Menlo, Consolas, monospace'
    ctx.textBaseline = 'top'
    ctx.fillText(`${top} ms`, 2, 1)
  }

  private async copy(): Promise<void> {
    const text = this.report()
    const msg = this.q('pf-msg')
    const manual = this.q<HTMLTextAreaElement>('pf-manual')
    const how = await copyText(text)
    if (how !== 'manual') {
      manual.hidden = true
      msg.textContent = 'Copied the report.'
    } else {
      // Clipboard blocked (some embedded frames): show it selected for a manual copy.
      manual.hidden = false
      manual.value = text
      manual.focus()
      manual.select()
      msg.textContent = 'Copy blocked here: the report is selected, press Ctrl+C (or long-press, Copy).'
    }
    setTimeout(() => {
      if (msg.isConnected) msg.textContent = ''
    }, 4000)
  }
}

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

function isTyping(el: Element | null): boolean {
  if (!el) return false
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true
  if (el instanceof HTMLInputElement) return !['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color', 'file'].includes(el.type)
  return (el as HTMLElement).isContentEditable === true
}

function num(v: number): string {
  return v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)
}

let injected = false
function injectStyles(): void {
  if (injected) return
  injected = true
  const rgba = (c: number, a: number): string => `rgba(${(c >> 16) & 255}, ${(c >> 8) & 255}, ${c & 255}, ${a})`
  const css = `
.pf {
  position: fixed; z-index: 30; pointer-events: none; box-sizing: border-box; width: 292px; max-width: calc(100vw - 12px);
  left: calc(6px + var(--discord-safe-area-inset-left, env(safe-area-inset-left, 0px)));
  bottom: calc(6px + var(--discord-safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)));
  padding: 6px 8px 6px; border-radius: 8px; border: 1px solid ${rgba(theme.boardEdge, 0.8)};
  background: ${rgba(theme.panel, 0.78)}; color: ${theme.text};
  font: 10.5px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-variant-numeric: tabular-nums;
  -webkit-user-select: none; user-select: none;
}
.pf-top { display: flex; align-items: baseline; gap: 4px; }
.pf-fps { font-size: 17px; font-weight: bold; min-width: 2ch; text-align: right; }
.pf-unit { color: ${theme.textMuted}; }
.pf-ctx { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: ${theme.textMuted}; margin-left: 4px; }
.pf-btn { pointer-events: auto; font: inherit; color: ${theme.text}; background: ${rgba(theme.board, 0.9)}; border: 1px solid ${rgba(theme.boardEdge, 1)}; border-radius: 5px; padding: 1px 6px; cursor: pointer; min-height: 22px; touch-action: manipulation; }
.pf-btn:hover, .pf-btn:focus-visible { border-color: ${cssHex(theme.player)}; outline: none; }
.pf-x { padding: 0 6px; font-size: 13px; line-height: 1; }
.pf-row { color: ${theme.textMuted}; }
.pf-row b { color: ${theme.text}; font-weight: bold; }
.pf-row i { font-style: normal; opacity: .7; }
.pf-env { pointer-events: auto; }
.pf-spark { display: block; width: 100%; height: 30px; margin: 3px 0 2px; border-radius: 3px; background: ${rgba(theme.dim, 0.55)}; }
.pf-manual { pointer-events: auto; display: block; width: 100%; box-sizing: border-box; margin-top: 4px; font: inherit; color: ${theme.text}; background: ${rgba(theme.dim, 0.9)}; border: 1px solid ${cssHex(theme.player)}; border-radius: 4px; resize: none; -webkit-user-select: text; user-select: text; }
.pf-manual[hidden] { display: none; }
.pf-msg:empty { display: none; }
.pf-compact .pf-sim, .pf-compact .pf-gfx, .pf-compact .pf-count, .pf-compact .pf-env { display: none; }
.pf-msg { color: ${cssHex(theme.player)}; white-space: normal; }
@media (max-width: 480px), (max-height: 420px) {
  .pf { width: 250px; font-size: 9.5px; padding: 4px 6px; }
  .pf-fps { font-size: 14px; }
  .pf-spark { height: 22px; }
}
`
  const style = document.createElement('style')
  style.textContent = css
  document.head.appendChild(style)
}

/** The one overlay for this page. */
export const perf = new PerfMonitor()
