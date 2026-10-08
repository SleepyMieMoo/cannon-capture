/**
 * Number crunching for the performance overlay (src/perf/PerfOverlay.ts).
 * Pure functions and a small ring buffer, so they can be unit tested.
 */

/** Time-stamped samples (ms values) in a fixed-size ring; old ones fall off. */
export class Series {
  private readonly t: Float64Array
  private readonly v: Float32Array
  private head = 0
  private size = 0

  constructor(readonly capacity = 2048) {
    this.t = new Float64Array(capacity)
    this.v = new Float32Array(capacity)
  }

  push(time: number, value: number): void {
    this.t[this.head] = time
    this.v[this.head] = value
    this.head = (this.head + 1) % this.capacity
    if (this.size < this.capacity) this.size++
  }

  clear(): void {
    this.head = 0
    this.size = 0
  }

  get length(): number {
    return this.size
  }

  /** Values from the last `ms` before `now`, oldest first. */
  since(now: number, ms: number): number[] {
    const out: number[] = []
    const from = now - ms
    for (let i = this.size; i >= 1; i--) {
      const k = (this.head - i + this.capacity) % this.capacity
      if (this.t[k] >= from) out.push(this.v[k])
    }
    return out
  }
}

export interface FrameSummary {
  /** Frames counted. */
  count: number
  /** Average time per frame (ms). */
  avg: number
  /** Average of the slowest 1% of frames (ms), at least one frame. */
  low1: number
  /** The single slowest frame (ms). */
  worst: number
}

/** Average, 1%-low and worst of a list of frame times (ms). */
export function summarize(values: readonly number[]): FrameSummary | null {
  if (!values.length) return null
  let sum = 0
  let worst = 0
  for (const v of values) {
    sum += v
    if (v > worst) worst = v
  }
  const sorted = [...values].sort((a, b) => b - a)
  const k = Math.max(1, Math.ceil(values.length * 0.01))
  let slow = 0
  for (let i = 0; i < k; i++) slow += sorted[i]
  return { count: values.length, avg: sum / values.length, low1: slow / k, worst }
}

/** Frames per second for a run of frame times (ms). */
export function fpsOf(frameMs: readonly number[]): number {
  let sum = 0
  for (const v of frameMs) sum += v
  return sum > 0 ? (1000 * frameMs.length) / sum : 0
}

/** Average and peak of a run of per-frame timings (ms), or null with no samples. */
export function avgMax(values: readonly number[]): { avg: number; max: number } | null {
  if (!values.length) return null
  let sum = 0
  let max = 0
  for (const v of values) {
    sum += v
    if (v > max) max = v
  }
  return { avg: sum / values.length, max }
}

export type PerfLevel = 'good' | 'ok' | 'bad'

/** 55+ FPS is smooth (green), 30 to 55 is playable but not smooth (yellow), under 30 is choppy (red). */
export function fpsLevel(fps: number): PerfLevel {
  return fps >= 55 ? 'good' : fps >= 30 ? 'ok' : 'bad'
}

/** Same thresholds as fpsLevel, in frame time: 18 ms (about 55 FPS) and 33 ms (30 FPS). */
export function frameLevel(ms: number): PerfLevel {
  return ms <= 1000 / 55 ? 'good' : ms <= 1000 / 30 ? 'ok' : 'bad'
}

/** "Chrome 141 · Windows" from a user agent string (good enough for bug reports). */
export function browserLabel(ua: string): string {
  const m = (re: RegExp): string | undefined => re.exec(ua)?.[1]
  const discord = m(/discord\/([\d.]+)/i)
  const browser = discord
    ? `Discord app ${discord}`
    : m(/Edg\/(\d+)/)
      ? `Edge ${m(/Edg\/(\d+)/)}`
      : m(/Firefox\/(\d+)/)
        ? `Firefox ${m(/Firefox\/(\d+)/)}`
        : m(/(?:Chrome|CriOS)\/(\d+)/)
          ? `Chrome ${m(/(?:Chrome|CriOS)\/(\d+)/)}`
          : m(/Version\/(\d+)[\d.]* .*Safari/)
            ? `Safari ${m(/Version\/(\d+)/)}`
            : 'Browser'
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad|iPod/.test(ua)
      ? 'iOS'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /CrOS/.test(ua)
            ? 'ChromeOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : '?'
  return `${browser} · ${os}`
}

/** Everything the overlay shows, for the one-line report. */
export interface PerfSnapshot {
  build: string
  platform: string
  browser: string
  renderer: string
  gpu: string | null
  canvas: { w: number; h: number; cssW: number; cssH: number; dpr: number }
  fps: number
  frame: FrameSummary | null
  logic: { avg: number; max: number } | null
  render: { avg: number; max: number } | null
  sim: { avg: number; max: number } | null
  ai: { avg: number; max: number } | null
  look: { avg: number; max: number } | null
  counts: { cannons: number; shots: number; sounds: number; fx?: string; particles?: number } | null
  /** What is on screen, e.g. 'battle: Huge Arena (huge, impossible)'. */
  context: string
  /** Online: the connection (left out otherwise). */
  net?: PerfNet | null
}

/** An online battle's connection, as the performance panel shows it. */
export interface PerfNet {
  /** Round trip to the server (ms, average of the last few pings; null: measuring or not online). */
  rtt: number | null
  /** How far behind the newest server picture the board is drawn, and the jitter behind that (ms). */
  delayMs: number
  jitterMs: number
  /** Data coming in (KB/s of text, before the WebSocket's compression). */
  kbps: number | null
  /** Own orders shown early so far, and ones the server turned down. */
  predicted: number
  refused: number
  /** Where the room runs, e.g. "SIN (apac)". */
  server: string | null
}

/** The ping's colour: like the battle bar's chip. */
export function pingLevel(rtt: number): PerfLevel {
  return rtt < 100 ? 'good' : rtt < 200 ? 'ok' : 'bad'
}

/** "ping 182 ms · buffer 95 ms (jitter 30) · 19.4 KB/s · server SIN (apac)". */
export function netText(n: PerfNet): string {
  return [
    `ping ${n.rtt === null ? '…' : Math.round(n.rtt)} ms`,
    `buffer ${n.delayMs} ms (jitter ${n.jitterMs})`,
    n.kbps === null ? null : `${n.kbps.toFixed(1)} KB/s`,
    `predicted ${n.predicted}${n.refused ? `, refused ${n.refused}` : ''}`,
    n.server ? `server ${n.server}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

const ms = (v: number): string => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2))
const am = (x: { avg: number; max: number } | null): string => (x ? `${ms(x.avg)}/${ms(x.max)}` : '-')

/** "1 sound", "3 sounds". */
export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

/** One line to paste into a bug report. Timings are avg/max ms over the last few seconds. */
export function perfReport(s: PerfSnapshot): string {
  const f = s.frame
  return [
    `Cannon Capture perf`,
    `build ${s.build}`,
    s.context,
    `FPS ${s.fps.toFixed(1)}`,
    f ? `frame avg ${ms(f.avg)} ms, 1% low ${ms(f.low1)} ms (${(1000 / f.low1).toFixed(0)} FPS), worst ${ms(f.worst)} ms over ${f.count} frames` : 'frame -',
    `logic ${am(s.logic)} ms`,
    s.sim ? `sim ${am(s.sim)} ms (AI ${am(s.ai)}, look-ahead ${am(s.look)})` : 'sim -',
    `render ${am(s.render)} ms`,
    s.counts ? `${plural(s.counts.cannons, 'cannon')}, ${plural(s.counts.shots, 'shot')}, ${plural(s.counts.sounds, 'sound')}${s.counts.fx ? `, effects ${s.counts.fx} (${s.counts.particles ?? 0} particles)` : ''}` : 'no battle',
    ...(s.net ? [`net ${netText(s.net)}`] : []),
    `canvas ${s.canvas.w}x${s.canvas.h} (css ${s.canvas.cssW}x${s.canvas.cssH}, DPR ${+s.canvas.dpr.toFixed(2)})`,
    s.gpu ? `${s.renderer} (${s.gpu})` : s.renderer,
    s.platform,
    s.browser,
  ].join(' | ')
}
