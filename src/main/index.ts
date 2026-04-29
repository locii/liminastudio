import { app, shell, BrowserWindow, Menu, ipcMain } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { join, extname } from 'path'
import { promises as fs, createReadStream } from 'fs'
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
          label: 'About Limina Studio',
          click: () => {
            const about = new BrowserWindow({
              width: 360,
              height: 220,
              resizable: false,
              minimizable: false,
              parent: mainWindow ?? undefined,
              modal: true,
              titleBarStyle: 'hidden',
              backgroundColor: '#1a1a1a',
              webPreferences: { sandbox: true },
            })
            about.loadURL(
              `data:text/html,<body style="font-family:system-ui;background:#1a1a1a;color:#e5e7eb;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;gap:8px;margin:0"><h2 style="margin:0;font-size:20px">Limina Studio</h2><p style="color:#9ca3af;margin:0;font-size:13px">v0.1.0</p><p style="color:#6b7280;margin:0;font-size:12px">Breathwork set editor</p></body>`
            )
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
