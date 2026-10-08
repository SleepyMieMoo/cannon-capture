/**
 * Discord Activity settings. The client ID is public (it is the Application ID
 * from the Discord Developer Portal), so it comes from a build-time variable:
 * VITE_DISCORD_CLIENT_ID locally, or the DISCORD_CLIENT_ID repository variable
 * in GitHub Actions. Without it the game still builds and runs everywhere; inside
 * Discord it just skips the SDK handshake. Never put the client secret here.
 */
export const DISCORD = {
  clientId: String(import.meta.env?.VITE_DISCORD_CLIENT_ID ?? '').trim(),
  /** Give up waiting for Discord's READY after this long (the game never waits for it). */
  handshakeTimeoutMs: 8000,
  /** Phones and tablets: battles are 16:9, so ask Discord to keep the Activity landscape. */
  mobileOrientation: 'landscape' as 'landscape' | 'unlocked',
}
