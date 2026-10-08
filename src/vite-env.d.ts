/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Discord application (client) ID. Public; set it for builds that run as a Discord Activity. */
  readonly VITE_DISCORD_CLIENT_ID?: string
  /** Online player vs player server (default: the live one on workers.dev). */
  readonly VITE_PVP_SERVER?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
