import { ipcMain, dialog } from 'electron'
import { promises as fs } from 'fs'
import { join, extname, basename, dirname, relative, normalize } from 'path'
import { homedir, platform } from 'os'
import { exec } from 'child_process'
import { promisify } from 'util'
import { parseFile } from 'music-metadata'
import { createHash } from 'crypto'
import type { LibraryFile, ScanResult, WatchedFolder } from '../../shared/types'

const execAsync = promisify(exec)

const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.flac', '.aiff', '.aif', '.m4a'])

function pickArtist(common: { artist?: string; artists?: string[] }): string {
  const joined = common.artists?.filter(Boolean).join(', ')
  if (joined) return joined
  const single = common.artist?.trim()
  return single ?? ''
}

function pickAlbum(common: { album?: string }): string {
  return common.album?.trim() ?? ''
}

function fileId(filePath: string): string {
  return createHash('sha1').update(filePath).digest('hex').slice(0, 16)
}

/**
 * "Date added" = the file's own creation date so it backfills deterministically
 * on every scan. Uses birthtime, falling back to mtime on filesystems that
 * don't record a birth time (where birthtime reads as 0 / epoch).
 */
function fileCreatedISO(stat: { birthtime: Date; mtime: Date }): string {
  const born = stat.birthtime
  if (born && born.getTime() > 0) return born.toISOString()
  return stat.mtime.toISOString()
}

/** Watched-folder relative path …/Artist/Album/ → album = innermost folder, artist = above. Single segment → artist only. */
function inferPathArtistAlbum(directoryPath: string, libraryRoot: string): { artistPathGuess: string; albumPathGuess: string } {
  const folder = normalize(directoryPath)
  const root = normalize(libraryRoot)
  const rel = relative(root, folder)
  if (!rel || rel.startsWith('..')) return { artistPathGuess: '', albumPathGuess: '' }
  const segments = rel.split(/[/\\\\]/).filter(Boolean)
  const n = segments.length
  if (n >= 2) return { artistPathGuess: segments[n - 2] ?? '', albumPathGuess: segments[n - 1] ?? '' }
  if (n === 1) return { artistPathGuess: segments[0] ?? '', albumPathGuess: '' }
  return { artistPathGuess: '', albumPathGuess: '' }
}

async function walkDir(dir: string): Promise<string[]> {
  const results: string[] = []
  let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>
  try {
    entries = await fs.readdir(dir, { withFileTypes: true }) as Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>
  } catch {
    return results
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...await walkDir(full))
    } else if (entry.isFile() && AUDIO_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      results.push(full)
    }
  }
  return results
}

/** Build a full LibraryFile from a path — reads stat + audio metadata. Shared by
 *  the initial folder scan and the incremental diff rescan. */
async function buildLibraryFile(filePath: string, folderPath: string): Promise<LibraryFile> {
  const stat = await fs.stat(filePath)
  const meta = await parseFile(filePath, { skipCovers: true, duration: true })
  const dirPath = dirname(filePath)
  const pathGuesses = inferPathArtistAlbum(dirPath, folderPath)
  return {
    id: fileId(filePath),
    filePath,
    fileName: basename(filePath),
    artist: pickArtist(meta.common),
    album: pickAlbum(meta.common),
    ...pathGuesses,
    appliedPathGuess: false,
    folderPath: dirPath,
    duration: meta.format.duration ?? 0,
    sampleRate: meta.format.sampleRate ?? 0,
    channels: meta.format.numberOfChannels ?? 0,
    format: extname(filePath).replace('.', '').toLowerCase(),
    fileSize: stat.size,
    tags: [],
    rating: 0,
    notes: '',
    breathworkPhase: null,
    dateAdded: fileCreatedISO(stat),
    peaks: [],
    trackTitle: '',
    mfbTrackId: null,
    mfbIndexed: false,
    mfbApplied: false,
    audioFeatures: null,
    audioFeaturesEstimated: false,
    featuresAnalyzed: false,
    albumImageUrl: null,
    bandcampUrl: null,
    beatportUrl: null,
    appleMusicUrl: null,
    mfbMatchRejected: false,
    introEndMs: null,
    outroStartMs: null,
    fadeInCurve: 0,
    fadeOutCurve: 0,
    clipStartMs: null,
    clipEndMs: null,
    cuesAnalyzed: false,
  }
}

export function registerScanHandlers(): void {
  ipcMain.handle('library:pickFolder', async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Add folder to library',
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('library:scanFolder', async (_, folderPath: string): Promise<ScanResult> => {
    const files: LibraryFile[] = []
    const errors: string[] = []
    const paths = await walkDir(folderPath)

    await Promise.all(
      paths.map(async (filePath) => {
        try {
          files.push(await buildLibraryFile(filePath, folderPath))
        } catch (e) {
          errors.push(`${filePath}: ${e}`)
        }
      })
    )

    return { files, errors }
  })

  // Incremental rescan: walk the folder but only parse metadata for paths that
  // aren't already known, so an occasional rescan stays cheap. `missing` lists
  // known paths under this folder that are gone from disk. The renderer's
  // addFiles merge is non-destructive, so the result can be applied freely
  // without clobbering user- or MFB-curated data on existing files.
  ipcMain.handle('library:diffFolder', async (_, folderPath: string, knownPaths: string[]): Promise<ScanResult & { missing: string[] }> => {
    const known = new Set(knownPaths.map(normalize))
    const diskPaths = await walkDir(folderPath)
    const diskSet = new Set(diskPaths.map(normalize))
    const added = diskPaths.filter((p) => !known.has(normalize(p)))
    const root = normalize(folderPath)
    const missing = knownPaths.filter((p) => normalize(p).startsWith(root) && !diskSet.has(normalize(p)))

    const files: LibraryFile[] = []
    const errors: string[] = []
    await Promise.all(
      added.map(async (filePath) => {
        try {
          files.push(await buildLibraryFile(filePath, folderPath))
        } catch (e) {
          errors.push(`${filePath}: ${e}`)
        }
      })
    )

    return { files, errors, missing }
  })

  ipcMain.handle('library:buildWatchedFolder', async (_, folderPath: string): Promise<WatchedFolder> => {
    const paths = await walkDir(folderPath)
    return {
      id: fileId(folderPath),
      path: folderPath,
      label: basename(folderPath),
      fileCount: paths.length,
      lastScanned: new Date().toISOString(),
    }
  })

  ipcMain.handle('library:findOnDisk', async (_, title: string, artist: string): Promise<string[]> => {
    const results: string[] = []

    // Sanitise a string for shell use
    const safe = (s: string): string => s.replace(/[\\'"`;|&<>(){}$!\n\r]/g, ' ').trim()

    // Extract meaningful words: drop short words and common stop words
    const STOP = new Set(['i','a','the','in','of','and','or','to','for','with','no','more',
      'at','is','it','on','be','as','by','an','my','we','he','she','they','but','not',
      'from','this','that','are','was','will','can','do','all','so','if','up','out'])
    function keyWords(s: string): string[] {
      return s.toLowerCase().split(/\s+/)
        .map(w => w.replace(/[^a-z0-9]/g, ''))
        .filter(w => w.length > 2 && !STOP.has(w))
    }

    const isAudio = (p: string): boolean => AUDIO_EXTENSIONS.has(extname(p).toLowerCase())

    async function mdfindName(term: string): Promise<string[]> {
      const { stdout } = await execAsync(`mdfind -name ${JSON.stringify(safe(term))}`, { timeout: 5000 })
      return stdout.trim().split('\n').filter(p => p && isAudio(p))
    }

    if (platform() === 'darwin') {
      try {
        // Try full title first
        const full = await mdfindName(title)
        results.push(...full)

        // If nothing, retry with each significant word from title then artist
        if (results.length === 0) {
          const words = [...keyWords(title), ...keyWords(artist)]
          for (const word of words) {
            const hits = await mdfindName(word)
            results.push(...hits)
            if (results.length > 0) break
          }
        }
      } catch { /* mdfind unavailable */ }

    } else if (platform() === 'win32') {
      const dirs = [join(homedir(), 'Music'), join(homedir(), 'Downloads'), join(homedir(), 'Desktop')]
        .map(d => `'${d.replace(/'/g, "''")}'`).join(',')
      const exts = ['*.wav','*.mp3','*.flac','*.aiff','*.aif','*.m4a'].join(',')

      // Build patterns from full title then key words as fallback
      const patterns = [title, ...keyWords(title), ...keyWords(artist)]
      for (const term of patterns) {
        const pat = `*${safe(term)}*`.replace(/'/g, "''")
        try {
          const { stdout } = await execAsync(
            `powershell -NoProfile -Command "Get-ChildItem -Path ${dirs} -Recurse -Include ${exts} -ErrorAction SilentlyContinue | Where-Object { $_.BaseName -like '${pat}' } | Select-Object -ExpandProperty FullName"`,
            { timeout: 15000 }
          )
          results.push(...stdout.trim().split('\r\n').filter(Boolean))
          if (results.length > 0) break
        } catch { /* ignore */ }
      }

    } else {
      const dirs = [join(homedir(), 'Music'), join(homedir(), 'music')]
        .filter(d => d).join(' ')
      const extPats = [...AUDIO_EXTENSIONS].map(e => `-name "*${e}"`).join(' -o ')
      const patterns = [title, ...keyWords(title), ...keyWords(artist)]
      for (const term of patterns) {
        try {
          const { stdout } = await execAsync(
            `find ${dirs} -type f \\( ${extPats} \\) -iname ${JSON.stringify(`*${safe(term)}*`)} 2>/dev/null`,
            { timeout: 15000 }
          )
          results.push(...stdout.trim().split('\n').filter(Boolean))
          if (results.length > 0) break
        } catch { /* ignore */ }
      }
    }

    return [...new Set(results)]
  })

  ipcMain.handle('library:pickAudioFile', async (): Promise<string | null> => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Select audio file',
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: ['wav','mp3','flac','aiff','aif','m4a'] }],
    })
    return canceled ? null : filePaths[0]
  })

  ipcMain.handle('library:scanFile', async (_, filePath: string): Promise<LibraryFile | null> => {
    try {
      const stat = await fs.stat(filePath)
      const dirPath = dirname(filePath)
      const base: LibraryFile = {
        id: fileId(filePath),
        filePath,
        fileName: basename(filePath),
        artist: '',
        album: '',
        artistPathGuess: '',
        albumPathGuess: '',
        appliedPathGuess: false,
        folderPath: dirPath,
        duration: 0,
        sampleRate: 0,
        channels: 0,
        format: extname(filePath).replace('.', '').toLowerCase(),
        fileSize: stat.size,
        tags: [],
        rating: 0,
        notes: '',
        breathworkPhase: null,
        dateAdded: new Date().toISOString(),
        peaks: [],
        trackTitle: '',
        mfbTrackId: null,
        mfbIndexed: false,
        mfbApplied: false,
        audioFeatures: null,
        audioFeaturesEstimated: false,
        featuresAnalyzed: false,
        albumImageUrl: null,
        bandcampUrl: null,
        beatportUrl: null,
        appleMusicUrl: null,
        mfbMatchRejected: false,
        introEndMs: null,
        outroStartMs: null,
        fadeInCurve: 0,
        fadeOutCurve: 0,
        clipStartMs: null,
        clipEndMs: null,
        cuesAnalyzed: false,
      }
      // 0-byte files (e.g. Dropbox cloud-only placeholders) can't be parsed —
      // return the stub so MFB data can still be linked; metadata fills in on rescan.
      if (stat.size === 0) return base
      try {
        const meta = await parseFile(filePath, { skipCovers: true, duration: true })
        return {
          ...base,
          artist: pickArtist(meta.common),
          album: pickAlbum(meta.common),
          duration: meta.format.duration ?? 0,
          sampleRate: meta.format.sampleRate ?? 0,
          channels: meta.format.numberOfChannels ?? 0,
        }
      } catch {
        return base
      }
    } catch {
      return null
    }
  })
}
