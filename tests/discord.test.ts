import { describe, expect, it } from 'vitest'
import { DiscordBridge, discordLaunch, externalUrl, validClientId, type SdkLike, type SdkLoader } from '../src/platform/discord'

const ID = '123456789012345678'
const IN_DISCORD = '?frame_id=f1&instance_id=i-1-gc-2-3&platform=desktop&guild_id=2&channel_id=3'

interface Fake {
  load: SdkLoader
  calls: { cmd: string; args: unknown }[]
  resolveReady: () => void
  created: string[]
}

function fakeSdk(opts: { throwOnCreate?: string; openFails?: boolean } = {}): Fake {
  const calls: Fake['calls'] = []
  const created: string[] = []
  let resolveReady = (): void => {}
  const ready = new Promise<void>((r) => (resolveReady = r))
  const sdk: SdkLike = {
    ready: () => ready,
    commands: {
      openExternalLink: async (args) => {
        calls.push({ cmd: 'openExternalLink', args })
        if (opts.openFails) throw new Error('nope')
        return { opened: true }
      },
      setOrientationLockState: async (args) => {
        calls.push({ cmd: 'setOrientationLockState', args })
      },
    },
  }
  return {
    calls,
    created,
    resolveReady: () => resolveReady(),
    load: async () => ({
      create: (id: string) => {
        if (opts.throwOnCreate) throw new Error(opts.throwOnCreate)
        created.push(id)
        return sdk
      },
      landscape: 3,
    }),
  }
}

const quiet = (): void => {}
const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('Discord launch detection', () => {
  it('needs both frame_id and instance_id', () => {
    expect(discordLaunch('')).toBeNull()
    expect(discordLaunch('?debug&level=skirmish')).toBeNull()
    expect(discordLaunch('?frame_id=f')).toBeNull()
    expect(discordLaunch('?instance_id=i')).toBeNull()
    expect(discordLaunch(IN_DISCORD)).toEqual({ frameId: 'f1', instanceId: 'i-1-gc-2-3', platform: 'desktop', guildId: '2', channelId: '3' })
  })

  it('accepts only snowflake client IDs', () => {
    expect(validClientId(ID)).toBe(true)
    expect(validClientId(` ${ID} `)).toBe(true)
    expect(validClientId('')).toBe(false)
    expect(validClientId(undefined)).toBe(false)
    expect(validClientId('your-client-id')).toBe(false)
    expect(validClientId('123')).toBe(false)
  })
})

describe('DiscordBridge', () => {
  it('does nothing in a normal browser tab', async () => {
    const f = fakeSdk()
    const b = new DiscordBridge({ search: '?debug', clientId: ID, timeoutMs: 50, load: f.load, log: quiet })
    expect(b.inDiscord).toBe(false)
    expect(await b.start()).toBe('web')
    expect(f.created).toEqual([])
    expect(b.openExternal('https://pixabay.com/')).toBe(false)
  })

  it('runs without the SDK when the build has no client ID', async () => {
    const f = fakeSdk()
    const b = new DiscordBridge({ search: IN_DISCORD, clientId: '', timeoutMs: 50, load: f.load, log: quiet })
    expect(b.inDiscord).toBe(true)
    expect(await b.start()).toBe('no-client-id')
    expect(f.created).toEqual([])
    expect(b.openExternal('https://pixabay.com/')).toBe(false)
  })

  it('becomes ready after the handshake and opens links through Discord', async () => {
    const f = fakeSdk()
    const b = new DiscordBridge({ search: IN_DISCORD, clientId: ID, timeoutMs: 1000, load: f.load, log: quiet })
    const started = b.start()
    await tick()
    expect(b.status).toBe('connecting')
    f.resolveReady()
    expect(await started).toBe('ready')
    expect(f.created).toEqual([ID])
    expect(b.openExternal('https://pixabay.com/x')).toBe(true)
    await tick()
    expect(f.calls).toEqual([{ cmd: 'openExternalLink', args: { url: 'https://pixabay.com/x' } }])
  })

  it('times out gracefully, and a late READY still counts', async () => {
    const f = fakeSdk()
    const b = new DiscordBridge({ search: IN_DISCORD, clientId: ID, timeoutMs: 20, load: f.load, log: quiet })
    expect(await b.start()).toBe('timeout')
    expect(b.openExternal('https://pixabay.com/')).toBe(false)
    f.resolveReady()
    await tick()
    expect(b.status).toBe('ready')
    expect(b.openExternal('https://pixabay.com/')).toBe(true)
  })

  it('survives the SDK throwing', async () => {
    const f = fakeSdk({ throwOnCreate: 'platform query param is not defined' })
    const b = new DiscordBridge({ search: '?frame_id=f&instance_id=i', clientId: ID, timeoutMs: 50, load: f.load, log: quiet })
    expect(await b.start()).toBe('error')
    expect(b.error).toContain('platform')
  })

  it('survives the SDK failing to load', async () => {
    const b = new DiscordBridge({ search: IN_DISCORD, clientId: ID, timeoutMs: 50, load: () => Promise.reject(new Error('chunk 404')), log: quiet })
    expect(await b.start()).toBe('error')
  })

  it('locks landscape on mobile only', async () => {
    for (const platform of ['mobile', 'desktop']) {
      const f = fakeSdk()
      const b = new DiscordBridge({ search: `?frame_id=f&instance_id=i&platform=${platform}`, clientId: ID, timeoutMs: 1000, load: f.load, log: quiet, mobileOrientation: 'landscape' })
      const s = b.start()
      f.resolveReady()
      await s
      await tick()
      const locks = f.calls.filter((c) => c.cmd === 'setOrientationLockState')
      expect(locks).toEqual(platform === 'mobile' ? [{ cmd: 'setOrientationLockState', args: { lock_state: 3 } }] : [])
    }
  })

  it('a failed openExternalLink is logged, not thrown', async () => {
    const logs: string[] = []
    const f = fakeSdk({ openFails: true })
    const b = new DiscordBridge({ search: IN_DISCORD, clientId: ID, timeoutMs: 1000, load: f.load, log: (m) => logs.push(m) })
    const s = b.start()
    f.resolveReady()
    await s
    expect(b.openExternal('https://pixabay.com/')).toBe(true)
    await tick()
    expect(logs.some((l) => l.includes('openExternalLink failed'))).toBe(true)
  })
})

describe('external link filter', () => {
  const base = 'https://123456789012345678.discordsays.com/?frame_id=f'
  it('sends only external http(s) links to Discord', () => {
    expect(externalUrl('https://pixabay.com/service/license-summary/', false, base)).toBe('https://pixabay.com/service/license-summary/')
    expect(externalUrl('http://example.com', false, base)).toBe('http://example.com/')
    expect(externalUrl('blob:https://x/1', false, base)).toBeNull()
    expect(externalUrl('https://pixabay.com/', true, base)).toBeNull()
    expect(externalUrl('#top', false, base)).toBeNull()
    expect(externalUrl('sfx/pop.ogg', false, base)).toBeNull()
    expect(externalUrl('mailto:a@b.c', false, base)).toBeNull()
    expect(externalUrl(null, false, base)).toBeNull()
  })
})
