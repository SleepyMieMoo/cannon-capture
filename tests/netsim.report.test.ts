import { describe, it } from 'vitest'
// @ts-expect-error: node's zlib (tests run in node; the game's types don't include node)
import { deflateRawSync } from 'node:zlib'
import { NetMatch, smoothness, type NetConditions } from './helpers/netSim'

/**
 * Not a pass/fail test: prints how online looks under bad networks
 * (NETSIM_REPORT=1 npx vitest run tests/netsim.report.test.ts).
 */
const REPORT = !!(globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.NETSIM_REPORT

const CASES: [string, NetConditions][] = [
  ['LAN 20 ms', { oneWayMs: 10, jitterMs: 0 }],
  ['100 ms, 20 jitter', { oneWayMs: 50, jitterMs: 20 }],
  ['250 ms, 40 jitter (UK-PH)', { oneWayMs: 125, jitterMs: 40 }],
  ['250 ms, 100 jitter + spikes', { oneWayMs: 125, jitterMs: 100, spikeChance: 0.02, spikeMs: 250 }],
  ['400 ms, 80 jitter', { oneWayMs: 200, jitterMs: 80 }],
]

function measure(net: NetConditions) {
  const m = new NetMatch([net, { ...net, seed: 2 }])
  m.run(1500)
  m.aimAll()
  m.run(2000)
  // Input: player 2 re-aims a cannon, swaps one, toggles auto on another.
  const p = m.players[1]
  const view = p.view!
  const mine = view.cannons.filter((c) => c.side === 'player')
  const theirs = view.cannons.filter((c) => c.side === 'enemy')
  const aimC = mine[0]
  const target = theirs[theirs.length - 1]
  const swapC = mine[1]
  const autoC = mine[2] ?? mine[1]
  const t0 = m.now
  const autoWas = autoC.autoTarget
  const newKind = swapC.kind === 'sniper' ? 'normal' : 'sniper'
  p.client!.send({ t: 'aim', cannon: aimC.id, at: { cannon: target.id } })
  p.client!.send({ t: 'swap', cannon: swapC.id, kind: newKind })
  p.client!.send({ t: 'auto', cannon: autoC.id }, !autoWas)
  // A real screen flips auto at once (predict()); the snapshot then says otherwise until the server's answer shows.
  autoC.autoTarget = !autoWas
  let aimSeen = -1
  let swapSeen = -1
  let autoFlips = 0
  let lastAuto = autoC.autoTarget
  let reverts = 0
  let lastAngle = aimC.angle
  let maxStep = 0
  m.onFrame = (i, t) => {
    if (i !== 1) return
    const step = Math.abs(Math.atan2(Math.sin(aimC.angle - lastAngle), Math.cos(aimC.angle - lastAngle)))
    lastAngle = aimC.angle
    maxStep = Math.max(maxStep, (step * 180) / Math.PI)
    if (aimSeen >= 0 && aimC.target?.id !== target.id && aimC.side === 'player') reverts++
    if (aimSeen < 0 && aimC.target?.id === target.id) aimSeen = t - t0
    if (swapSeen < 0 && swapC.kind === newKind) swapSeen = t - t0
    if (autoC.autoTarget !== lastAuto) {
      autoFlips++
      lastAuto = autoC.autoTarget
    }
  }
  m.run(3000)
  m.onFrame = null
  m.run(6000)
  const s = smoothness(m.frames[1], t0 - 2000, m.now)
  const secs = (m.now - t0 + 2000) / 1000
  const recent = p.transport.texts.filter((x) => x.t >= t0 - 2000)
  const bytes = recent.reduce((n, x) => n + x.text.length, 0) / secs
  const snaps = recent.filter((x) => x.text.startsWith('{"t":"snap"'))
  const perMsgDeflate = recent.reduce((n, x) => n + deflateRawSync(x.text).length, 0) / secs
  const streamDeflate = deflateRawSync(recent.map((x) => x.text).join('')).length / secs
  const snapBytes = snaps.reduce((n, x) => n + x.text.length, 0) / Math.max(1, snaps.length)
  return { s, perMsg: perMsgDeflate / 1024, stream: streamDeflate / 1024, snapBytes, snapsPerSec: snaps.length / secs, aimSeen, swapSeen, autoFlips, reverts, maxStep, kbps: bytes / 1024 }
}

describe.runIf(REPORT)('online under bad networks (report)', () => {
  it('prints', () => {
    const rows = CASES.map(([name, net]) => {
      const r = measure(net)
      return {
        network: name,
        'aim shows (ms)': r.aimSeen,
        'swap shows (ms)': r.swapSeen,
        'auto flicker': r.autoFlips,
        'aim reverts': r.reverts,
        'barrel max °/frame': +r.maxStep.toFixed(1),
        'clock stalls': r.s.stalls,
        'clock jumps': r.s.jumps,
        backwards: r.s.backwards,
        'clock rms (ms)': +r.s.clockRms.toFixed(1),
        'shot jerks %': +((100 * r.s.shotJerks) / Math.max(1, r.s.shotSteps)).toFixed(1),
        'behind server (ms)': Math.round(r.s.behindMs),
        'KB/s in': +r.kbps.toFixed(1),
        'KB/s deflated': `${r.stream.toFixed(1)}-${r.perMsg.toFixed(1)}`,
        'snap bytes': Math.round(r.snapBytes),
        'snaps/s': +r.snapsPerSec.toFixed(1),
        frames: r.s.frames,
      }
    })
    console.table(rows)
  })
})
