import { SFX, type PopKind, type PopSpec } from '../config/sfx'
import type { Rect, Side } from '../types'

export type SfxConfig = typeof SFX

/** A pop the game wants to play. */
export interface PopRequest {
  kind: PopKind
  /** Who made it (cannon id), for the per-cannon rate limit. */
  source?: string
  /** Side of the cannon that fired (or flipped / lost its barrier). */
  side: Side
  x: number
  y: number
  /** ms (any clock that only goes forward). */
  now: number
  /** The board area on screen, in world units, and the camera zoom (1 = near). */
  view: Rect
  zoom: number
}

/** How to play it (or null: skipped). */
export interface PopPlan {
  id: number
  kind: PopKind
  volume: number
  rate: number
  /** Cents. */
  detune: number
  /** -1 left .. 1 right. */
  pan: number
  /** A playing pop to stop first, to make room. */
  steal: number | null
}

interface Voice {
  id: number
  end: number
  volume: number
}

export type SkipReason = 'source' | 'kind' | 'voices' | 'silent' | 'burst'

/** Pure voice logic (no Phaser): loudness, pitch, voice cap and rate limits. */
export class PopPlanner {
  private readonly active: Voice[] = []
  private readonly lastBySource = new Map<string, number>()
  private readonly lastByKind = new Map<PopKind, number>()
  /** When recent pops started (burst cap), overall and per kind. */
  private readonly recent: { kind: PopKind; at: number }[] = []
  private nextId = 1
  readonly stats = { played: {} as Partial<Record<PopKind, number>>, skipped: {} as Partial<Record<SkipReason, number>>, stolen: 0 }

  constructor(
    private readonly cfg: SfxConfig = SFX,
    private readonly rng: () => number = Math.random,
  ) {}

  spec(kind: PopKind): PopSpec {
    if (kind === 'capture') return this.cfg.capture
    if (kind === 'shieldBreak') return this.cfg.shieldBreak
    return this.cfg.shot[kind]
  }

  /** Pops still sounding at `now`. */
  playing(now: number): number {
    this.prune(now)
    return this.active.length
  }

  /** Loudness for a request, before the voice cap (0..1, without the master volume). */
  gain(req: PopRequest): number {
    const cfg = this.cfg
    let g = this.spec(req.kind).volume
    const shot = req.kind !== 'capture'
    if (shot && req.side !== 'player') g *= cfg.otherSideGain
    const v = req.view
    const dx = Math.max(v.x - req.x, 0, req.x - (v.x + v.w))
    const dy = Math.max(v.y - req.y, 0, req.y - (v.y + v.h))
    const d = Math.hypot(dx, dy)
    if (d > 0) {
      const t = Math.min(1, d / cfg.offscreen.fadePx)
      g *= 1 - (1 - cfg.offscreen.gain) * t
    }
    const z = Math.max(0, Math.min(1, req.zoom))
    g *= cfg.zoomedOutMin + (1 - cfg.zoomedOutMin) * z
    return g
  }

  plan(req: PopRequest): PopPlan | null {
    const cfg = this.cfg
    this.prune(req.now)
    if (req.source !== undefined) {
      const last = this.lastBySource.get(req.source)
      if (last !== undefined && req.now - last < cfg.sourceGapMs) return this.skip('source')
    }
    if (this.burstFull(req.kind, req.now)) return this.skip('burst')
    const lastKind = this.lastByKind.get(req.kind)
    if (lastKind !== undefined && req.now - lastKind < cfg.kindGapMs[req.kind]) return this.skip('kind')
    const volume = this.gain(req) / (1 + cfg.crowd * this.active.length)
    if (volume <= 1e-4) return this.skip('silent')
    let steal: number | null = null
    if (this.active.length >= cfg.maxVoices) {
      let quietest = this.active[0]
      for (const v of this.active) if (v.volume < quietest.volume) quietest = v
      if (volume < quietest.volume * cfg.stealRatio) return this.skip('voices')
      steal = quietest.id
      this.release(steal)
      this.stats.stolen += 1
    }
    const spec = this.spec(req.kind)
    const detune = Math.round((this.rng() * 2 - 1) * spec.jitterCents)
    const id = this.nextId++
    const length = cfg.sampleMs / spec.rate
    this.active.push({ id, end: req.now + length, volume })
    if (req.source !== undefined) this.lastBySource.set(req.source, req.now)
    this.lastByKind.set(req.kind, req.now)
    this.recent.push({ kind: req.kind, at: req.now })
    this.stats.played[req.kind] = (this.stats.played[req.kind] ?? 0) + 1
    const v = req.view
    const pan = v.w > 0 ? Math.max(-1, Math.min(1, (req.x - (v.x + v.w / 2)) / (v.w / 2))) * cfg.pan : 0
    return { id, kind: req.kind, volume, rate: spec.rate, detune, pan, steal }
  }

  /** Forget every voice and limit (after coming back to the tab, or stopping everything). */
  reset(): void {
    this.active.length = 0
    this.recent.length = 0
    this.lastBySource.clear()
    this.lastByKind.clear()
  }

  /** Too many pops of this kind, or overall, in the last burst window? */
  private burstFull(kind: PopKind, now: number): boolean {
    const b = this.cfg.burst
    while (this.recent.length && (now - this.recent[0].at >= b.windowMs || this.recent[0].at > now)) this.recent.shift()
    if (this.recent.length >= b.total) return true
    let same = 0
    for (const r of this.recent) if (r.kind === kind) same++
    return same >= b.perKind
  }

  /** A pop stopped early (or was stolen). */
  release(id: number): void {
    const i = this.active.findIndex((v) => v.id === id)
    if (i >= 0) this.active.splice(i, 1)
  }

  private prune(now: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) if (this.active[i].end <= now) this.active.splice(i, 1)
  }

  private skip(why: SkipReason): null {
    this.stats.skipped[why] = (this.stats.skipped[why] ?? 0) + 1
    return null
  }
}
