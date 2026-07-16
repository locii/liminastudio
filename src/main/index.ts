import { app, shell, BrowserWindow, Menu, ipcMain, clipboard, nativeImage } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { join, extname, basename } from 'path'
import { promises as fs, createReadStream, readFileSync } from 'fs'
import { createServer } from 'http'
import { spawn } from 'child_process'
import ffmpegPath from 'ffmpeg-static'
import type { AddressInfo } from 'net'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'

function initAutoUpdater(): void {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => console.log('[updater] checking'))
  autoUpdater.on('update-not-available', () => console.log('[updater] up to date'))
  autoUpdater.on('error', (e) => console.log('[updater] error', e.message))
  autoUpdater.on('update-available', (info) => {
    console.log('[updater] update available', info.version)
    mainWindow?.webContents.send('updater:downloading')
  })
  autoUpdater.on('download-progress', (p) => {
    const pct = Math.round(p.percent)
    console.log('[updater] progress', pct + '%')
    mainWindow?.webContents.send('updater:downloading', pct)
  })
  autoUpdater.on('update-downloaded', (info) => {
    console.log('[updater] downloaded', info.version)
    mainWindow?.webContents.send('updater:downloaded', info.version)
  })
  ipcMain.on('updater:quitAndInstall', () => {
    autoUpdater.quitAndInstall()
  })
  ipcMain.handle('updater:check', async () => {
    const result = await autoUpdater.checkForUpdates()
    return { hasUpdate: !!result?.downloadPromise, version: result?.updateInfo.version ?? null }
  })
  setTimeout(() => autoUpdater.checkForUpdates().catch((e) => console.log('[updater] check failed', e.message)), 10_000)
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1_000)
}

function mimeForAudioExt(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  return (({
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.flac': 'audio/flac',
    '.ogg': 'audio/ogg',
    '.oga': 'audio/ogg',
    '.opus': 'audio/opus',
    '.webm': 'audio/webm',
    '.aiff': 'audio/aiff',
    '.aif': 'audio/aiff',
    '.m4a': 'audio/mp4',
    '.mp4': 'audio/mp4',
    '.aac': 'audio/mp4',
  }) as Record<string, string>)[ext] ?? 'audio/mpeg'
}

// Chromium's HTMLAudioElement WAV decoder reliably plays only 16-bit integer PCM.
// Float32 / 24-bit / WAVE_FORMAT_EXTENSIBLE files fall back to the device output
// rate (48kHz on macOS), so 44.1kHz files play ~9% fast. Peek the RIFF header so
// Library's Auto-Mix engine can route those through ffmpeg→FLAC instead of raw.
async function inspectWavFormat(filePath: string): Promise<{ formatCode: number; bitsPerSample: number } | null> {
  let fd: import('fs').promises.FileHandle | undefined
  try {
    fd = await fs.open(filePath, 'r')
    const buf = Buffer.alloc(65536)
    const { bytesRead } = await fd.read(buf, 0, 65536, 0)
    if (bytesRead < 12) return null
    const riff = buf.toString('ascii', 0, 4)
    const wave = buf.toString('ascii', 8, 12)
    if ((riff !== 'RIFF' && riff !== 'RF64' && riff !== 'BW64') || wave !== 'WAVE') return null
    let pos = 12
    while (pos + 8 <= bytesRead) {
      const chunkId = buf.toString('ascii', pos, pos + 4)
      const chunkSize = buf.readUInt32LE(pos + 4)
      if (chunkId === 'fmt ' && pos + 8 + 16 <= bytesRead) {
        const formatCode = buf.readUInt16LE(pos + 8)
        const bitsPerSample = buf.readUInt16LE(pos + 8 + 14)
        // WAVE_FORMAT_EXTENSIBLE stores the real format code in the sub-format GUID.
        if (formatCode === 0xfffe && chunkSize >= 40 && pos + 8 + 26 <= bytesRead) {
          return { formatCode: buf.readUInt16LE(pos + 8 + 24), bitsPerSample }
        }
        return { formatCode, bitsPerSample }
      }
      pos += 8 + chunkSize + (chunkSize & 1)
    }
    return null
  } catch {
    return null
  } finally {
    await fd?.close()
  }
}

let audioServerPort = 0

function startAudioServer(): void {
  const ffmpeg = (ffmpegPath as string).replace('app.asar', 'app.asar.unpacked')

  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Accept-Ranges', 'bytes')

    const url = new URL('http://x' + (req.url ?? ''))
    let filePath = decodeURIComponent(url.pathname)
    // Windows drive paths arrive as "/C:/a/b.mp3" — drop the leading slash so
    // fs/ffmpeg get a valid "C:/a/b.mp3". POSIX paths ("/Users/…") are untouched.
    if (/^\/[A-Za-z]:\//.test(filePath)) filePath = filePath.slice(1)

    let size = 0
    try { size = (await fs.stat(filePath)).size } catch {
      console.error('[audio server] not found', filePath)
      res.writeHead(404); res.end(); return
    }

    // Library's Auto-Mix engine tags its requests with ?sr= (and ?ss= for a
    // fade-in offset). Mix's own <audio> playback sends NO query params and must
    // keep streaming raw with range support so `audio.currentTime` seeking works
    // — so the ffmpeg transcode path is gated on those params and never touches Mix.
    const isMixEngine = url.searchParams.has('sr')
    const sr = parseInt(url.searchParams.get('sr') ?? '0') || 0
    const startSec = parseFloat(url.searchParams.get('ss') ?? '0') || 0
    const ext = extname(filePath).slice(1).toLowerCase()
    const browserNative = new Set(['mp3', 'm4a', 'mp4', 'aac', 'ogg', 'oga', 'opus', 'webm', 'flac'])
    const needsResample = sr > 48000
    let wavSafe = false
    if (ext === 'wav') {
      const fmt = await inspectWavFormat(filePath)
      wavSafe = !!(fmt && fmt.formatCode === 1 && fmt.bitsPerSample === 16)
    }
    const needsTranscode =
      startSec > 0 ||
      (isMixEngine && (needsResample || !(browserNative.has(ext) || (ext === 'wav' && wavSafe))))

    if (!needsTranscode) {
      const mime = mimeForAudioExt(filePath)
      const rangeHeader = req.headers['range']
      if (rangeHeader) {
        const m = rangeHeader.match(/bytes=(\d+)-(\d*)/)
        if (!m) { res.writeHead(416); res.end(); return }
        const start = parseInt(m[1], 10)
        const end = m[2] ? parseInt(m[2], 10) : size - 1
        res.writeHead(206, {
          'Content-Type': mime,
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Content-Length': String(end - start + 1),
        })
        createReadStream(filePath, { start, end }).pipe(res)
      } else {
        res.writeHead(200, { 'Content-Type': mime, 'Content-Length': String(size) })
        createReadStream(filePath).pipe(res)
      }
      return
    }

    // Transcode to FLAC — its framed bitstream streams cleanly and fixes the WAV
    // speed skew. `-ss` before `-i` = fast input seek so the stream starts at the
    // offset with no (pop-prone) client seek. Resample only when source > 48kHz.
    const ffArgs = [
      ...(startSec > 0 ? ['-ss', String(startSec)] : []),
      '-i', filePath,
      '-vn', '-ac', '2',
      ...(needsResample ? ['-ar', '48000'] : []),
      '-f', 'flac', '-compression_level', '0', 'pipe:1',
    ]
    res.writeHead(200, { 'Content-Type': 'audio/flac' })
    const ff = spawn(ffmpeg, ffArgs)
    ff.stdout.pipe(res)
    ff.stderr.resume()
    req.on('close', () => ff.kill())
    ff.on('error', () => { res.end() })
  })

  server.listen(0, '127.0.0.1', () => {
    audioServerPort = (server.address() as AddressInfo).port
    console.log(`[audio server] listening on port ${audioServerPort}`)
  })
}

// Small waveform-bars icon shown under the cursor when dragging a library track.
function createDragIcon(): Electron.NativeImage {
  const size = 32
  const buf = Buffer.alloc(size * size * 4)
  const bars = [4, 7, 10, 13, 16, 19, 22, 25, 28]
  const heights = [10, 18, 24, 20, 28, 22, 16, 12, 8]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      buf[i] = 26; buf[i + 1] = 26; buf[i + 2] = 26; buf[i + 3] = 220
      for (let b = 0; b < bars.length; b++) {
        if (x === bars[b] || x === bars[b] + 1) {
          const top = Math.round(16 - heights[b] / 2)
          const bot = Math.round(16 + heights[b] / 2)
          if (y >= top && y <= bot) {
            buf[i] = 99; buf[i + 1] = 102; buf[i + 2] = 241; buf[i + 3] = 255
          }
        }
      }
    }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size })
}

import { registerFileHandlers } from './ipc/fileHandlers'
import { registerAudioHandlers } from './ipc/audioHandlers'
import { registerFfmpegHandlers } from './ipc/ffmpegHandlers'
import { registerSessionHandlers, getRecent } from './ipc/sessionHandlers'
import { registerPdfHandlers } from './ipc/pdfHandlers'
import { registerMfbHandlers } from './ipc/mfbHandlers'
// Ported from Limina Library
import { registerScanHandlers } from './ipc/scanHandlers'
import { registerCatalogueHandlers } from './ipc/catalogueHandlers'
import { registerAuthHandlers } from './ipc/authHandlers'
import { registerStudioHandlers } from './ipc/studioHandlers'
import { registerMfbMatchHandlers } from './ipc/mfbMatchHandlers'
import { registerLibraryAudioHandlers } from './ipc/libraryAudioHandlers'

let mainWindow: BrowserWindow | null = null
let pendingOpenFile: string | null = null

// macOS: file opened before the window is ready
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  if (mainWindow?.webContents) {
    mainWindow.webContents.send('session:fileOpened', filePath)
  } else {
    pendingOpenFile = filePath
  }
})

function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

function send(channel: string): void {
  mainWindow?.webContents.send(channel)
}

async function createAppMenu(): Promise<void> {
  const recent = await getRecent()
  const openRecentSubmenu: MenuItemConstructorOptions[] = recent.length > 0
    ? recent.map((filePath) => ({
        label: basename(filePath, '.limina'),
        toolTip: filePath,
        click: (): void => mainWindow?.webContents.send('menu:openRecent', filePath),
      }))
    : [{ label: 'No Recent Sessions', enabled: false }]

  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'Add Track…', accelerator: 'CmdOrCtrl+T', click: () => send('menu:addTrack') },
        { type: 'separator' },
        { label: 'Save Session', accelerator: 'CmdOrCtrl+S', click: () => send('menu:save') },
        { label: 'Open Session…', accelerator: 'CmdOrCtrl+O', click: () => send('menu:open') },
        { label: 'Open Recent', submenu: openRecentSubmenu },
        { label: 'Import Session from Other App…', click: () => send('menu:import') },
        { type: 'separator' },
        { label: 'Export Mix…', accelerator: 'CmdOrCtrl+E', click: () => send('menu:export') },
        { type: 'separator' },
        { label: 'Collect Project Files', click: () => send('menu:collect') },
        { label: 'Export Project as ZIP…', click: () => send('menu:exportZip') },
        { type: 'separator' },
        { label: 'Rebuild Waveforms', click: () => send('menu:rebuildWaveforms') },
        { label: 'Export Waveform Data…', click: () => send('menu:exportWaveformData') },
        { label: 'Sync MFB Data', click: () => send('menu:syncMfbData') },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => send('menu:undo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: () => send('menu:redo') },
        { type: 'separator' },
        { label: 'Delete Clip', accelerator: 'Backspace', click: () => send('menu:deleteClip') },
      ],
    },
    { role: 'viewMenu' },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Limina Mix',
          click: () => {
            const version = app.getVersion()
            const year = new Date().getFullYear()
            const about = new BrowserWindow({
              width: 400,
              height: 280,
              resizable: false,
              minimizable: false,
              parent: mainWindow ?? undefined,
              modal: true,
              titleBarStyle: 'hidden',
              backgroundColor: '#1a1a1a',
              webPreferences: { sandbox: true },
            })
            const logoPath = is.dev
              ? join(app.getAppPath(), 'resources/creamLogo.png')
              : join(process.resourcesPath, 'creamLogo.png')
            let logoSrc = ''
            try {
              logoSrc = `data:image/png;base64,${readFileSync(logoPath).toString('base64')}`
            } catch (e) {
              console.error('[about] logo not found at', logoPath, e)
            }
            const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #1a1a1a;
    color: #e5e7eb;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    gap: 8px;
    padding: 28px;
    text-align: center;
    -webkit-app-region: drag;
  }
  img { width: 72px; height: 72px; object-fit: contain; margin-bottom: 4px; }
  h1 { font-size: 20px; font-weight: 600; letter-spacing: -0.3px; }
  .version { font-size: 12px; color: #6366f1; font-weight: 500; }
  .desc { font-size: 12px; color: #9ca3af; line-height: 1.5; max-width: 280px; }
  .divider { width: 40px; height: 1px; background: #2a2a2a; margin: 2px 0; }
  .meta { font-size: 11px; color: #4b5563; }
  button {
    margin-top: 12px;
    padding: 6px 20px;
    background: #27272a;
    color: #9ca3af;
    border: 1px solid #3f3f46;
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
    -webkit-app-region: no-drag;
  }
  button:hover { background: #3f3f46; color: #e5e7eb; }
</style>
</head><body>
  ${logoSrc ? `<img src="${logoSrc}" alt="Limina Mix logo" />` : ''}
  <h1>Limina Mix</h1>
  <div class="version">v${version}</div>
  <div class="divider"></div>
  <p class="desc">A multitrack audio editor for Holotropic Breathwork facilitators.</p>
  <div class="divider"></div>
  <div class="meta">&copy; ${year} Anthony Olsen &nbsp;&middot;&nbsp; Built with Electron &amp; Tone.js</div>
  <button onclick="window.close()">Close</button>
<script>document.addEventListener('keydown', e => { if (e.key === 'Escape') window.close() })</script>
</body></html>`
            about.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`)
          },
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0f0f0f',
    titleBarStyle: 'hiddenInset',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
    mainWindow!.setTitle('Limina Mix')
    mainWindow!.webContents.setVisualZoomLevelLimits(1, 1)
    if (pendingOpenFile) {
      mainWindow!.webContents.send('session:fileOpened', pendingOpenFile)
      pendingOpenFile = null
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.limina')

  if (!is.dev) initAutoUpdater()

  if (is.dev) {
    // Simulate update flow for UI testing — triggered from renderer console:
    // window.electronAPI.simulateUpdate()
    ipcMain.on('updater:simulate', () => {
      let pct = 0
      const tick = setInterval(() => {
        pct = Math.min(100, pct + 10)
        mainWindow?.webContents.send('updater:downloading', pct)
        if (pct >= 100) {
          clearInterval(tick)
          setTimeout(() => mainWindow?.webContents.send('updater:downloaded', '9.9.9'), 300)
        }
      }, 300)
    })
  }

  startAudioServer()
  ipcMain.handle('audio:getServerPort', () => audioServerPort)

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerFileHandlers()
  registerAudioHandlers()
  registerFfmpegHandlers(getMainWindow)
  registerSessionHandlers(() => createAppMenu().catch(console.error))
  registerPdfHandlers(getMainWindow)
  registerMfbHandlers()
  // Library data layer
  registerScanHandlers()
  registerCatalogueHandlers()
  registerAuthHandlers()
  registerStudioHandlers()
  registerMfbMatchHandlers()
  registerLibraryAudioHandlers()

  // Menu:addTrack sends renderer the same signal as button click
  ipcMain.on('window:setTitle', (_, title: string) => {
    mainWindow?.setTitle(title)
  })

  // Library UI window zoom (accessibility setting).
  ipcMain.on('window:setZoom', (_, factor: number) => {
    mainWindow?.webContents.setZoomFactor(factor)
  })

  // Drag a library track out onto the timeline (native file drag).
  ipcMain.on('library:startDrag', (event, filePath: string) => {
    event.sender.startDrag({ file: filePath, icon: createDragIcon() })
    event.returnValue = null // required for sendSync
  })

  // Copy a library file's path to the clipboard.
  ipcMain.handle('library:copyFile', (_, filePath: string) => {
    clipboard.writeText(filePath)
  })

  createAppMenu().catch(console.error)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
