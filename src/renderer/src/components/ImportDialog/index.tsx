import { useState, useEffect } from 'react'

const FORMAT_LABELS: Record<string, string> = {
  sesx: 'Adobe Audition Session',
  aup: 'Audacity Project (legacy XML)',
}

export interface ImportFile {
  content: string
  filePath: string
  ext: string
}

interface Props {
  open: boolean
  onClose: () => void
  onImport: (file: ImportFile, collectFolder: string | null, onProgress: (pct: number) => void) => Promise<void>
}

export function ImportDialog({ open, onClose, onImport }: Props): JSX.Element | null {
  const [selected, setSelected] = useState<ImportFile | null>(null)
  const [collect, setCollect] = useState(false)
  const [collectFolder, setCollectFolder] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressLabel, setProgressLabel] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Reset to empty state each time the dialog opens
  useEffect(() => {
    if (open) {
      setSelected(null)
      setCollect(false)
      setCollectFolder(null)
      setProgress(0)
      setProgressLabel('')
      setError(null)
      setImporting(false)
    }
  }, [open])

  if (!open) return null

  const handleChooseFile = async (): Promise<void> => {
    setError(null)
    const result = await window.electronAPI.importFile()
    if (!result) return
    if (!FORMAT_LABELS[result.ext]) {
      setError(`Unsupported format: .${result.ext}`)
      return
    }
    setSelected(result)
    setCollectFolder(null)
  }

  const handleChooseFolder = async (): Promise<void> => {
    const folder = await window.electronAPI.pickFolder()
    if (folder) setCollectFolder(folder)
  }

  const handleImport = async (): Promise<void> => {
    if (!selected) return
    setImporting(true)
    setProgress(0)
    setProgressLabel('Parsing session…')
    setError(null)
    try {
      await onImport(selected, collect ? collectFolder : null, (pct) => {
        setProgress(pct)
        if (pct < 20) setProgressLabel('Parsing session…')
        else if (pct < 50) setProgressLabel('Copying files…')
        else setProgressLabel('Loading waveforms…')
      })
      setSelected(null)
      setCollect(false)
      setCollectFolder(null)
      onClose()
    } catch (e) {
      setError(String(e))
      setImporting(false)
      setProgress(0)
    }
  }

  const fileName = selected ? selected.filePath.split('/').pop() : null
  const formatLabel = selected ? (FORMAT_LABELS[selected.ext] ?? selected.ext.toUpperCase()) : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="flex flex-col gap-5 p-6 w-[480px] rounded-lg border bg-surface-panel border-surface-border shadow-2xl">
        <h2 className="text-sm font-semibold text-gray-200">Import Session</h2>

        {/* File picker */}
        <div className="flex flex-col gap-2">
          <label className="text-xs text-gray-500 uppercase tracking-wider">Session file</label>
          <div className="flex gap-2 items-center">
            <button
              onClick={handleChooseFile}
              disabled={importing}
              className="px-3 py-1.5 text-sm text-gray-300 rounded border transition-colors bg-surface-base border-surface-border hover:bg-surface-hover shrink-0 disabled:opacity-40"
            >
              Choose file…
            </button>
            {fileName ? (
              <div className="overflow-hidden min-w-0">
                <p className="text-sm text-gray-200 truncate">{fileName}</p>
                <p className="text-xs text-gray-500">{formatLabel}</p>
              </div>
            ) : (
              <p className="text-sm text-gray-600">Supports .sesx · .aup</p>
            )}
          </div>
        </div>

        {/* Collect checkbox */}
        <div className="flex flex-col gap-2">
          <label className="flex gap-2 items-center cursor-pointer select-none">
            <input
              type="checkbox"
              checked={collect}
              disabled={importing}
              onChange={(e) => {
                setCollect(e.target.checked)
                if (!e.target.checked) setCollectFolder(null)
              }}
              className="accent-accent"
            />
            <span className="text-sm text-gray-300">Copy audio files into a folder</span>
          </label>

          {collect && (
            <div className="flex gap-2 items-center pl-6">
              <button
                onClick={handleChooseFolder}
                disabled={importing}
                className="px-3 py-1.5 text-sm text-gray-300 rounded border transition-colors bg-surface-base border-surface-border hover:bg-surface-hover shrink-0 disabled:opacity-40"
              >
                Choose folder…
              </button>
              {collectFolder ? (
                <p className="text-xs text-gray-400 truncate min-w-0">{collectFolder}</p>
              ) : (
                <p className="text-xs text-gray-600">No folder selected</p>
              )}
            </div>
          )}
        </div>

        {/* Progress bar */}
        {importing && (
          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between items-baseline">
              <span className="text-xs text-gray-400">{progressLabel}</span>
              <span className="text-xs text-gray-600">{progress}%</span>
            </div>
            <div className="overflow-hidden h-1.5 rounded-full bg-surface-base">
              <div
                className="h-full rounded-full transition-all duration-200 bg-accent"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Error */}
        {error && <p className="px-3 py-2 text-xs text-red-400 rounded bg-red-950/40">{error}</p>}

        {/* Actions */}
        <div className="flex gap-2 justify-end pt-1">
          <button
            onClick={onClose}
            disabled={importing}
            className="px-4 py-2 text-sm text-gray-400 rounded transition-colors hover:text-gray-200 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={!selected || importing || (collect && !collectFolder)}
            className="px-4 py-2 text-sm font-medium text-white rounded transition-colors bg-accent hover:bg-accent/80 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {importing ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  )
}
