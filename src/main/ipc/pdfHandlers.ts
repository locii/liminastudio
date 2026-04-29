import { ipcMain, BrowserWindow, dialog } from 'electron'
import { promises as fs } from 'fs'

export function registerPdfHandlers(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle('export:tracklistPDF', async (_, html: string): Promise<string | null> => {
    const win = getMainWindow()
    const result = await dialog.showSaveDialog(win ?? undefined!, {
      title: 'Save Track Listing',
      defaultPath: 'tracklisting.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (result.canceled || !result.filePath) return null

    const hidden = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true },
    })
    await hidden.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    const pdfBuffer = await hidden.webContents.printToPDF({ pageSize: 'A4' })
    hidden.close()

    await fs.writeFile(result.filePath, pdfBuffer)
    return result.filePath
  })
}
