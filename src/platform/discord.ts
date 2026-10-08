/**
 * Running as a Discord Activity (https://docs.discord.com/developers/activities/overview).
 *
 * Discord loads the game in an iframe on https://<client_id>.discordsays.com with
 * frame_id, instance_id and platform query parameters. Here we:
 *  - detect that from the URL (the plain web version never loads the SDK),
 *  - start the Embedded App SDK and wait for ready() with a timeout; the game
 *    starts straight away and never waits for Discord,
 *  - skip OAuth: nothing we use (ready, openExternalLink, setOrientationLockState)
 *    needs a scope, so no server and no client secret,
 *  - open external links (credits) with commands.openExternalLink, since the
 *    sandboxed iframe can't open new tabs itself.
 */

export type DiscordStatus =
  | 'web' // normal browser tab: nothing Discord-related happens
  | 'no-client-id' // inside Discord, but this build has no VITE_DISCORD_CLIENT_ID
  | 'connecting' // SDK created, waiting for READY
  | 'ready' // handshake done
  | 'timeout' // no READY in time; the game runs anyway (a late READY still upgrades to 'ready')
  | 'error' // the SDK threw (bad query params, failed to load); the game runs anyway

export interface DiscordLaunch {
  frameId: string
  instanceId: string
  platform: string | null
  guildId: string | null
  channelId: string | null
}

/** Launch parameters Discord adds to the iframe URL, or null in a normal browser tab. */
export function discordLaunch(search: string): DiscordLaunch | null {
  const p = new URLSearchParams(search)
  const frameId = p.get('frame_id')
  const instanceId = p.get('instance_id')
  if (!frameId || !instanceId) return null
  return { frameId, instanceId, platform: p.get('platform'), guildId: p.get('guild_id'), channelId: p.get('channel_id') }
}

/** Discord application IDs are snowflakes: 17 to 20 digits. */
export function validClientId(id: string | undefined | null): id is string {
  return typeof id === 'string' && /^\d{17,20}$/.test(id.trim())
}

/** The part of the SDK we use; DiscordSDK satisfies it and tests can fake it. */
export interface SdkLike {
  ready(): Promise<void>
  commands: {
    openExternalLink(args: { url: string }): Promise<unknown>
    setOrientationLockState(args: { lock_state: number }): Promise<unknown>
  }
}

export type SdkLoader = () => Promise<{ create: (clientId: string) => SdkLike; landscape: number }>

/** The real SDK, loaded only inside Discord so the web bundle stays as it was. */
const loadRealSdk: SdkLoader = async () => {
  const mod = await import('@discord/embedded-app-sdk')
  return {
    create: (clientId: string) => new mod.DiscordSDK(clientId) as unknown as SdkLike,
    landscape: mod.Common.OrientationLockStateTypeObject.LANDSCAPE,
  }
}

export interface DiscordOptions {
  search: string
  clientId: string
  timeoutMs: number
  mobileOrientation?: 'landscape' | 'unlocked'
  load?: SdkLoader
  log?: (msg: string) => void
}

/** A link the Discord client should open for us: absolute http(s), not a download. */
export function externalUrl(href: string | null | undefined, download = false, base = 'https://example.invalid/'): string | null {
  if (!href || download) return null
  try {
    const u = new URL(href, base)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    // Same-origin links stay inside the Activity.
    if (u.origin === new URL(base).origin) return null
    return u.href
  } catch {
    return null
  }
}

export class DiscordBridge {
  status: DiscordStatus
  readonly launch: DiscordLaunch | null
  /** How long the handshake took (ms), once ready. */
  readyMs: number | null = null
  error: string | null = null
  private sdk: SdkLike | null = null
  private readonly opts: DiscordOptions
  private readonly log: (msg: string) => void

  constructor(opts: DiscordOptions) {
    this.opts = opts
    this.log = opts.log ?? ((m) => console.info(`[discord] ${m}`))
    this.launch = discordLaunch(opts.search)
    this.status = !this.launch ? 'web' : validClientId(opts.clientId) ? 'connecting' : 'no-client-id'
  }

  get inDiscord(): boolean {
    return this.launch != null
  }

  get ready(): boolean {
    return this.status === 'ready'
  }

  /**
   * Start the handshake. Resolves once READY arrives, the timeout passes or the
   * SDK fails; it never rejects, and nobody needs to wait for it.
   */
  async start(): Promise<DiscordStatus> {
    if (this.status === 'web') return this.status
    if (this.status === 'no-client-id') {
      this.log('running inside Discord, but this build has no VITE_DISCORD_CLIENT_ID; skipping the SDK')
      return this.status
    }
    const t0 = Date.now()
    try {
      const { create, landscape } = await (this.opts.load ?? loadRealSdk)()
      const sdk = create(this.opts.clientId.trim())
      this.sdk = sdk
      const ready = sdk.ready().then(() => {
        this.readyMs = Date.now() - t0
        const late = this.status === 'timeout'
        this.status = 'ready'
        this.log(late ? `READY arrived late (${this.readyMs} ms)` : `ready in ${this.readyMs} ms`)
        this.afterReady(sdk, landscape)
      })
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, this.opts.timeoutMs)
      })
      await Promise.race([ready, timeout])
      if (timer) clearTimeout(timer)
      if (this.status === 'connecting') {
        this.status = 'timeout'
        this.log(`no READY from Discord after ${this.opts.timeoutMs} ms; playing without it`)
      }
    } catch (e) {
      this.status = 'error'
      this.error = e instanceof Error ? e.message : String(e)
      this.log(`SDK failed (${this.error}); playing without it`)
    }
    return this.status
  }

  private afterReady(sdk: SdkLike, landscape: number): void {
    if (this.launch?.platform === 'mobile' && this.opts.mobileOrientation === 'landscape') {
      sdk.commands.setOrientationLockState({ lock_state: landscape }).catch((e: unknown) => this.log(`orientation lock failed: ${describe(e)}`))
    }
  }

  /**
   * Open an external URL through Discord. Returns false when it can't (normal
   * web, or no handshake), so the caller keeps the browser's own behaviour.
   */
  openExternal(url: string): boolean {
    if (!this.sdk || this.status !== 'ready') return false
    this.sdk.commands.openExternalLink({ url }).catch((e: unknown) => this.log(`openExternalLink failed: ${describe(e)}`))
    return true
  }

  /** Inside Discord: route clicks on external links through openExternalLink. */
  interceptLinks(doc: Document): void {
    if (!this.inDiscord) return
    doc.addEventListener(
      'click',
      (ev) => {
        const a = (ev.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
        if (!a) return
        const url = externalUrl(a.getAttribute('href'), a.hasAttribute('download'), doc.location.href)
        if (url && this.openExternal(url)) ev.preventDefault()
      },
      true,
    )
  }
}

function describe(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return String(e)
}
