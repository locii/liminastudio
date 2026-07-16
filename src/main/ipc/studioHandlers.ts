import { ipcMain, dialog, shell } from 'electron'
import { promises as fs } from 'fs'

export function registerStudioHandlers(): void {
  ipcMain.handle('studio:saveSession', async (_, json: string, defaultName: string) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Save Limina Studio Session',
      defaultPath: `${defaultName}.limina`,
      filters: [{ name: 'Limina Session', extensions: ['limina'] }],
    })
    if (canceled || !filePath) return null
    await fs.writeFile(filePath, json, 'utf-8')
    return filePath
  })

  ipcMain.handle('studio:openFile', async (_, filePath: string) => {
    await shell.openPath(filePath)
  })
}
