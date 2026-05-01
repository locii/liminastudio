import { app, shell, BrowserWindow, Menu, ipcMain } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { join, extname } from 'path'
import { promises as fs, createReadStream, readFileSync } from 'fs'
import { createServer } from 'http'
import type { AddressInfo } from 'net'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

function audioMime(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  return (({
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.flac': 'audio/flac',
    '.ogg': 'audio/ogg',
    '.aiff': 'audio/aiff',
    '.aif': 'audio/aiff',
    '.m4a': 'audio/mp4',
  }) as Record<string, string>)[ext] ?? 'audio/mpeg'
}

let audioServerPort = 0

function startAudioServer(): void {
  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Accept-Ranges', 'bytes')

    const filePath = decodeURIComponent(new URL('http://x' + (req.url ?? '')).pathname)
    try {
      const { size } = await fs.stat(filePath)
      const mime = audioMime(filePath)
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
    } catch (err) {
      console.error('[audio server]', filePath, err)
      res.writeHead(404); res.end()
    }
  })

  server.listen(0, '127.0.0.1', () => {
    audioServerPort = (server.address() as AddressInfo).port
    console.log(`[audio server] listening on port ${audioServerPort}`)
  })
}

import { registerFileHandlers } from './ipc/fileHandlers'
import { registerAudioHandlers } from './ipc/audioHandlers'
import { registerFfmpegHandlers } from './ipc/ffmpegHandlers'
import { registerSessionHandlers } from './ipc/sessionHandlers'
import { registerPdfHandlers } from './ipc/pdfHandlers'

let mainWindow: BrowserWindow | null = null

function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

function send(channel: string): void {
  mainWindow?.webContents.send(channel)
}

function createAppMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'Add Track…', accelerator: 'CmdOrCtrl+T', click: () => send('menu:addTrack') },
        { type: 'separator' },
        { label: 'Save Session', accelerator: 'CmdOrCtrl+S', click: () => send('menu:save') },
        { label: 'Open Session…', accelerator: 'CmdOrCtrl+O', click: () => send('menu:open') },
        { label: 'Import Session from Other App…', click: () => send('menu:import') },
        { type: 'separator' },
        { label: 'Export Mix…', accelerator: 'CmdOrCtrl+E', click: () => send('menu:export') },
        { type: 'separator' },
        { label: 'Collect Project Files', click: () => send('menu:collect') },
        { label: 'Export Project as ZIP…', click: () => send('menu:exportZip') },
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
          label: 'Check for Updates…',
          click: () => mainWindow?.webContents.send('menu:checkForUpdates'),
        },
        { type: 'separator' },
        {
          label: 'About Limina Studio',
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
  ${logoSrc ? `<img src="${logoSrc}" alt="Limina Studio logo" />` : ''}
  <h1>Limina Studio</h1>
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
    mainWindow!.setTitle('Limina Studio')
    // Prevent Electron from intercepting pinch-to-zoom for page zoom —
    // we handle it ourselves in the renderer with wheel+ctrlKey.
    mainWindow!.webContents.setVisualZoomLevelLimits(1, 1)
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

  startAudioServer()
  ipcMain.handle('audio:getServerPort', () => audioServerPort)

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerFileHandlers()
  registerAudioHandlers()
  registerFfmpegHandlers(getMainWindow)
  registerSessionHandlers()
  registerPdfHandlers(getMainWindow)

  // Menu:addTrack sends renderer the same signal as button click
  ipcMain.on('window:setTitle', (_, title: string) => {
    mainWindow?.setTitle(title)
  })

  createAppMenu()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
