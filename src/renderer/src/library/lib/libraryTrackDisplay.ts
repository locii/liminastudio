import type { LibraryFile } from '../types'

export function displayedArtist(file: LibraryFile): string {
  if (file.mfbTrackId) return file.artist.trim() || '—'
  if (!file.appliedPathGuess && file.artistPathGuess.trim())
    return file.artistPathGuess.trim()
  return file.artist.trim() || file.artistPathGuess.trim() || '—'
}

export function displayedAlbum(file: LibraryFile): string {
  if (file.mfbTrackId) return file.album.trim() || '—'
  if (!file.appliedPathGuess && file.albumPathGuess.trim())
    return file.albumPathGuess.trim()
  return file.album.trim() || file.albumPathGuess.trim() || '—'
}

export function artistGuessPendingItalic(file: LibraryFile): boolean {
  return !file.mfbTrackId && !file.appliedPathGuess && file.artistPathGuess.trim().length > 0
}

export function albumGuessPendingItalic(file: LibraryFile): boolean {
  return !file.mfbTrackId && !file.appliedPathGuess && file.albumPathGuess.trim().length > 0
}

/** True while folder guesses exist and haven't been confirmed with Apply */
export function hasPendingPathGuess(file: LibraryFile): boolean {
  return (
    !file.mfbTrackId &&
    !file.appliedPathGuess &&
    Boolean(file.artistPathGuess.trim() || file.albumPathGuess.trim())
  )
}

/** Sort/filter key: pending guess overrides embedded for ordering */
export function artistSortKey(file: LibraryFile): string {
  if (!file.appliedPathGuess && file.artistPathGuess.trim()) return file.artistPathGuess.trim()
  return file.artist.trim() || file.artistPathGuess.trim()
}

export function albumSortKey(file: LibraryFile): string {
  if (!file.appliedPathGuess && file.albumPathGuess.trim()) return file.albumPathGuess.trim()
  return file.album.trim() || file.albumPathGuess.trim()
}

export function pathGuessUpdatesForApply(file: LibraryFile): Pick<LibraryFile, 'artist' | 'album' | 'appliedPathGuess'> {
  return {
    artist: file.artistPathGuess.trim() || file.artist,
    album: file.albumPathGuess.trim() || file.album,
    appliedPathGuess: true,
  }
}
