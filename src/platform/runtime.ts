import { DISCORD } from '../config/discord'
import { DiscordBridge } from './discord'

/** The one bridge for this page. In a normal browser tab its status is 'web' and it does nothing. */
export const discord = new DiscordBridge({
  search: typeof window === 'undefined' ? '' : window.location.search,
  clientId: DISCORD.clientId,
  timeoutMs: DISCORD.handshakeTimeoutMs,
  mobileOrientation: DISCORD.mobileOrientation,
})
