#!/usr/bin/env node
/**
 * Renders the store art with the game's own drawing code (art/index.html):
 *
 *   art/discord-cover-1920x1080.png                 Discord: Activities > Art Assets > Cover Art
 *   art/discord-embedded-background-1920x1080.png   Discord: Activities > Art Assets > Embedded Background
 *   art/discord-icon-1024.png                       Discord: General Information > App Icon
 *   art/discord-icon-512.png                        the same icon at 512 px, in case a smaller upload is wanted
 *   art/preview-1280x720.png                        README / social preview
 *   public/favicon.png, public/apple-touch-icon.png the web favicon (from the icon)
 *
 * Usage: node scripts/render-art.mjs [--checks <dir>]
 *   --checks <dir>  also write small-size readability checks (icon at 32/64/128 px, shelf tile mocks).
 *
 * Needs a Chrome or Chromium: CHROME_PATH, else /usr/bin/google-chrome. Titles use Verdana
 * (the game's font); install it for a faithful render, otherwise the browser falls back.
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

const root = resolve(import.meta.dirname, '..')
const artDir = resolve(root, 'art')
const publicDir = resolve(root, 'public')
const argv = process.argv.slice(2)
const checksDir = argv.includes('--checks') ? resolve(argv[argv.indexOf('--checks') + 1]) : null

const ASSETS = [
  { kind: 'cover', file: 'discord-cover-1920x1080.png', w: 1920, h: 1080 },
  { kind: 'background', file: 'discord-embedded-background-1920x1080.png', w: 1920, h: 1080 },
  { kind: 'icon', file: 'discord-icon-1024.png', w: 1024, h: 1024 },
  { kind: 'preview', file: 'preview-1280x720.png', w: 1280, h: 720 },
]

const chrome = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync)
if (!chrome) throw new Error('No Chrome found: set CHROME_PATH')

const server = await createServer({ root, logLevel: 'error', server: { port: 0, strictPort: false } })
await server.listen()
const base = server.resolvedUrls.local[0]
const browser = await chromium.launch({
  executablePath: chrome,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--font-render-hinting=none'],
})

const kb = (n) => `${(n / 1024).toFixed(0)} KB`
const files = {}
try {
  for (const a of ASSETS) {
    const page = await browser.newPage({ viewport: { width: a.w, height: a.h }, deviceScaleFactor: 1 })
    page.on('pageerror', (e) => console.error(`[${a.kind}]`, e.message))
    await page.goto(`${base}art/index.html?kind=${a.kind}`)
    await page.waitForFunction(() => window.__artReady, null, { timeout: 120_000 })
    const info = await page.evaluate(() => window.__artReady)
    const png = await page.screenshot({ clip: { x: 0, y: 0, width: a.w, height: a.h }, omitBackground: false })
    await writeFile(resolve(artDir, a.file), png)
    files[a.kind] = png
    console.log(`${a.file}  ${a.w}x${a.h}  ${kb(png.length)}  (sim ${info.t} ms, ${info.shots} shots, ring ${info.progress})`)
    await page.close()
  }

  // Downscaled copies (favicon, checks) are made in the browser with high-quality resampling.
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 })
  await page.goto(`${base}art/index.html?kind=none`)
  const dataUrl = (buf) => `data:image/png;base64,${buf.toString('base64')}`
  const resize = async (buf, w, h) => {
    const out = await page.evaluate(
      async ({ src, w, h }) => {
        const img = await (await fetch(src)).blob()
        const bmp = await createImageBitmap(img, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' })
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        c.getContext('2d').drawImage(bmp, 0, 0)
        return c.toDataURL('image/png')
      },
      { src: dataUrl(buf), w, h },
    )
    return Buffer.from(out.split(',')[1], 'base64')
  }
  for (const [dir, file, px] of [
    ['art', 'discord-icon-512.png', 512],
    ['public', 'favicon.png', 64],
    ['public', 'apple-touch-icon.png', 180],
  ]) {
    const png = await resize(files.icon, px, px)
    await writeFile(resolve(dir === 'art' ? artDir : publicDir, file), png)
    console.log(`${dir}/${file}  ${px}x${px}  ${kb(png.length)}`)
  }

  if (checksDir) {
    await mkdir(checksDir, { recursive: true })
    const icon = {}
    for (const px of [32, 64, 128]) {
      icon[px] = await resize(files.icon, px, px)
      await writeFile(resolve(checksDir, `icon-${px}.png`), icon[px])
    }
    // A sheet: the icon at real size (square and round, dark and light), the same pixels
    // blown up 4x so they can be inspected, and shelf-tile mocks of the cover (16:9 and 13:11).
    const sheet = await browser.newPage({ viewport: { width: 1180, height: 760 }, deviceScaleFactor: 1 })
    const cover = dataUrl(files.cover)
    const ic = (px) => dataUrl(icon[px])
    const html = `<!doctype html><html><body style="margin:0;background:#2b2d31;color:#dbdee1;font:13px Verdana,sans-serif">
<div style="padding:16px 20px;display:flex;gap:40px;align-items:flex-end">
${['#313338', '#ffffff']
  .map(
    (bg) => `<div style="background:${bg};padding:14px;border-radius:8px;display:flex;gap:18px;align-items:flex-end">
  ${[32, 64, 128].map((px) => `<div style="text-align:center"><img src="${ic(px)}" width="${px}" height="${px}"><br><img src="${ic(px)}" width="${px}" height="${px}" style="border-radius:50%;margin-top:6px"><div style="color:#888;margin-top:4px">${px}px</div></div>`).join('')}
</div>`,
  )
  .join('')}
<div style="display:flex;gap:18px;align-items:flex-end">
  <div style="text-align:center"><img src="${ic(32)}" width="128" height="128" style="image-rendering:pixelated"><div style="color:#888">32px x4</div></div>
  <div style="text-align:center"><img src="${ic(64)}" width="128" height="128" style="image-rendering:pixelated"><div style="color:#888">64px x2</div></div>
</div></div>
<div style="padding:4px 20px 20px;display:flex;gap:28px;align-items:flex-start">
${[
  ['16:9 tile', 400, 225],
  ['13:11 tile', 286, 242],
  ['small 16:9', 220, 124],
]
  .map(
    ([label, w, h]) => `<div><div style="width:${w}px;height:${h}px;border-radius:8px;background:url(${cover}) center/cover;position:relative"></div>
  <div style="display:flex;align-items:center;gap:8px;margin-top:8px"><img src="${ic(64)}" width="32" height="32" style="border-radius:50%"><b>Cannon Capture</b></div>
  <div style="color:#888;margin-top:2px">${label} (${w}x${h})</div></div>`,
  )
  .join('')}
</div></body></html>`
    await sheet.setContent(html)
    await sheet.waitForTimeout(300)
    await sheet.screenshot({ path: resolve(checksDir, 'readability-sheet.png'), fullPage: true })
    console.log(`checks written to ${checksDir}`)
  }
} finally {
  await browser.close()
  await server.close()
}
