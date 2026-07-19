import { useState, useEffect, useRef, useCallback } from 'react'
import { useLibraryStore } from '../store/libraryStore'
import { useUpdaterStore } from '../../updaterStore'
import { useUIStore } from '../../uiStore'

export function AccountButton({ menuItems, pendingCount = 0, onApplyPending }: {
  menuItems?: React.ReactNode
  pendingCount?: number
  onApplyPending?: () => void
} = {}): JSX.Element {
  const userAccount = useLibraryStore((s) => s.userAccount)
  const setUserAccount = useLibraryStore((s) => s.setUserAccount)
  const setLoginFlash = useLibraryStore((s) => s.setLoginFlash)
  const showModal = useLibraryStore((s) => s.showLoginModal)
  const setShowModal = useLibraryStore((s) => s.setShowLoginModal)
  const { downloading, downloadPercent, readyVersion } = useUpdaterStore()
  const devForceEmpty = useUIStore((s) => s.devForceEmpty)
  const toggleDevForceEmpty = useUIStore((s) => s.toggleDevForceEmpty)
  const devSkipLoad = useUIStore((s) => s.devSkipLoad)
  const setDevSkipLoad = useUIStore((s) => s.setDevSkipLoad)
  const [checkState, setCheckState] = useState<'idle' | 'checking' | 'upToDate'>('idle')
  const [showMenu, setShowMenu] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const handleCheckForUpdates = useCallback(async (): Promise<void> => {
    if (checkState !== 'idle') return
    setCheckState('checking')
    try {
      const [result] = await Promise.all([
        window.electronAPI.checkForUpdates(),
        new Promise<void>((r) => setTimeout(r, 800)),
      ])
      if (!result.hasUpdate) {
        setCheckState('upToDate')
        setTimeout(() => setCheckState('idle'), 3000)
      } else {
        setCheckState('idle')
      }
    } catch {
      setCheckState('upToDate')
      setTimeout(() => setCheckState('idle'), 3000)
    }
  }, [checkState])

  // Restore session on mount (no sync — server already has current state)
  useEffect(() => {
    window.electronAPI.authMe().then((user) => {
      if (user) setUserAccount(user)
    })
  }, [setUserAccount])

  // Close menu on outside click
  useEffect(() => {
    if (!showMenu) return
    function onDown(e: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [showMenu])

  async function handleLogin(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const user = await window.electronAPI.authLogin(email, password)
      setUserAccount(user)
      setLoginFlash(true)
      setShowModal(false)
      setEmail('')
      setPassword('')
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      const isAuthError = /401|403|invalid|incorrect|password|credentials|unauthorized/i.test(msg)
      setError(isAuthError ? 'Incorrect email or password.' : 'Login failed — please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleLogout(): Promise<void> {
    setShowMenu(false)
    await window.electronAPI.authLogout()
    setUserAccount(null)
  }

  if (userAccount) {
    return (
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setShowMenu((v) => !v)}
          className="relative flex items-center gap-1.5 h-6 px-2.5 text-[11px] text-gray-400 hover:text-gray-200 bg-surface-hover border border-surface-border rounded transition-colors"
        >
          <span className="w-4 h-4 rounded-full bg-accent/30 text-accent text-[9px] font-semibold flex items-center justify-center shrink-0">
            {userAccount.name.charAt(0).toUpperCase()}
          </span>
          <span className="max-w-[100px] truncate">{userAccount.name}</span>
          {readyVersion && !pendingCount && (
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" title={`Update v${readyVersion} ready`} />
          )}
          {pendingCount > 0 && (
            <span
              className="absolute -top-1.5 -right-1.5 min-w-[15px] h-[15px] px-1 rounded-full bg-accent text-white text-[8px] font-semibold leading-none flex items-center justify-center ring-2 ring-surface-panel"
              title={`${pendingCount} pending ${pendingCount === 1 ? 'match' : 'matches'} to apply`}
            >
              {pendingCount}
            </span>
          )}
        </button>
        {showMenu && (
          <div className="absolute right-0 top-8 z-50 min-w-[170px] rounded border border-surface-border bg-surface-panel shadow-lg py-1 text-[11px]">
            <div className="px-3 py-2 border-b border-surface-border">
              <p className="font-medium text-gray-300 truncate">{userAccount.name}</p>
              <p className="text-gray-600 truncate">{userAccount.email}</p>
            </div>
            {pendingCount > 0 && onApplyPending && (
              <button
                type="button"
                onClick={() => { setShowMenu(false); onApplyPending() }}
                className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-accent hover:bg-surface-hover transition-colors"
              >
                <svg className="w-3 h-3 shrink-0" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1.5 5l2.5 2.5L8.5 2" />
                </svg>
                Apply {pendingCount} pending {pendingCount === 1 ? 'match' : 'matches'}
              </button>
            )}
            {menuItems && (
              <div onClick={() => setShowMenu(false)} className="border-t border-surface-border">
                {menuItems}
              </div>
            )}
            <div className="border-t border-surface-border" />
            <button
              type="button"
              onClick={() => window.open('https://musicforbreathwork.com/dashboard', '_blank')}
              className="w-full text-left px-3 py-1.5 text-gray-400 hover:bg-surface-hover hover:text-gray-200 transition-colors"
            >
              Account settings ↗
            </button>
            <div className="border-t border-surface-border" />
            {readyVersion ? (
              <button
                type="button"
                onClick={() => { setShowMenu(false); window.electronAPI.quitAndInstall() }}
                className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-green-400 hover:bg-surface-hover transition-colors"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                Restart to install v{readyVersion}
              </button>
            ) : downloading ? (
              <div className="px-3 py-1.5 text-gray-500 flex items-center gap-2">
                <svg className="w-3 h-3 animate-spin text-accent shrink-0" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                Downloading{downloadPercent > 0 ? ` ${downloadPercent}%` : '…'}
              </div>
            ) : checkState === 'checking' ? (
              <div className="px-3 py-1.5 text-gray-600 text-[11px]">Checking for updates…</div>
            ) : checkState === 'upToDate' ? (
              <div className="px-3 py-1.5 text-gray-600 text-[11px]">Up to date · v{__APP_VERSION__}</div>
            ) : (
              <button
                type="button"
                onClick={handleCheckForUpdates}
                className="w-full text-left px-3 py-1.5 text-gray-400 hover:bg-surface-hover hover:text-gray-200 transition-colors"
              >
                Check for updates · v{__APP_VERSION__}
              </button>
            )}
            <div className="border-t border-surface-border" />
            <button
              type="button"
              onClick={handleLogout}
              className="w-full text-left px-3 py-1.5 text-gray-400 hover:bg-surface-hover hover:text-gray-200 transition-colors"
            >
              Sign out
            </button>
            {import.meta.env.DEV && (<>
              <div className="border-t border-surface-border" />
              <button
                type="button"
                onClick={() => { toggleDevForceEmpty(); setShowMenu(false) }}
                className={`w-full text-left flex items-center gap-2 px-3 py-1.5 transition-colors ${devForceEmpty ? 'text-orange-400 hover:bg-surface-hover' : 'text-gray-600 hover:bg-surface-hover hover:text-gray-400'}`}
              >
                <span className="font-mono text-[12px] leading-none">∅</span>
                {devForceEmpty ? 'Exit onboarding preview' : 'Preview onboarding (new user)'}
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (devSkipLoad) {
                    await window.electronAPI.devRestoreLibrary()
                    setDevSkipLoad(false)
                    setShowMenu(false)
                    window.location.reload()
                    return
                  }
                  await window.electronAPI.devResetLibrary()
                  useLibraryStore.setState({ watchedFolders: [], files: [], userAccount: null, pendingMatches: {}, selectedFileId: null, selectedFolderId: null })
                  setDevSkipLoad(true)
                  try { ['limina-login-skipped', 'limina-tried-session', 'limina-tried-mix', 'limina-nextsteps-dismissed'].forEach((k) => localStorage.removeItem(k)) } catch {}
                  useUIStore.getState().setSurface('home')
                  setShowMenu(false)
                  window.location.reload()
                }}
                className={`w-full text-left flex items-center gap-2 px-3 py-1.5 transition-colors ${devSkipLoad ? 'text-orange-400 hover:bg-surface-hover' : 'text-red-500 hover:bg-surface-hover'}`}
              >
                <span className="font-mono text-[12px] leading-none">↺</span>
                {devSkipLoad ? 'Restore my library' : 'Reset to new user'}
              </button>
            </>)}
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 h-6 px-3 text-[11px] text-gray-500 hover:text-gray-300 bg-surface-hover border border-surface-border rounded transition-colors"
        >
          Sign in
        </button>
        {import.meta.env.DEV && (
          <>
            <button
              type="button"
              onClick={toggleDevForceEmpty}
              title={devForceEmpty ? 'Exit onboarding preview' : 'Preview onboarding (new user)'}
              className={`flex items-center justify-center h-6 w-6 font-mono text-[12px] border rounded transition-colors ${devForceEmpty ? 'text-orange-400 border-orange-400/40 bg-orange-400/10' : 'text-gray-600 border-surface-border bg-surface-hover hover:text-gray-400'}`}
            >
              ∅
            </button>
            <button
              type="button"
              onClick={async () => {
                if (devSkipLoad) {
                  await window.electronAPI.devRestoreLibrary()
                  setDevSkipLoad(false)
                  window.location.reload()
                  return
                }
                await window.electronAPI.devResetLibrary()
                useLibraryStore.setState({ watchedFolders: [], files: [], userAccount: null, pendingMatches: {}, selectedFileId: null, selectedFolderId: null })
                setDevSkipLoad(true)
                try { localStorage.removeItem('limina-onboarding-dismissed'); localStorage.removeItem('limina-onboarding-step') } catch {}
                useUIStore.getState().setSurface('home')
                window.location.reload()
              }}
              title={devSkipLoad ? 'Restore my library (click to exit new-user mode)' : 'Reset to new user'}
              className={`flex items-center justify-center h-6 w-6 font-mono text-[12px] border rounded transition-colors ${devSkipLoad ? 'text-orange-400 border-orange-400/40 bg-orange-400/10' : 'text-red-600 border-red-600/30 bg-surface-hover hover:text-red-400'}`}
            >
              ↺
            </button>
          </>
        )}
      </div>

      {showModal && (
        <div className="flex fixed inset-0 z-50 justify-center items-center bg-black/70 backdrop-blur-sm">
          <div className="flex w-[640px] max-w-[90vw] rounded-xl border shadow-2xl border-surface-border bg-surface-panel overflow-hidden">

            {/* Left — benefits panel */}
            <div className="flex flex-col gap-5 p-8 w-60 shrink-0 bg-surface-base border-r border-surface-border">
              <div className="flex flex-col gap-1">
                <span className="text-[11px] uppercase tracking-widest text-gray-600">Unlock with</span>
                <span className="text-[14px] font-semibold text-gray-300 leading-snug">Music for Breathwork</span>
              </div>
              <div className="flex flex-col gap-4 mt-1">
                {[
                  { icon: '◎', label: 'Catalogue matching' },
                  { icon: '◈', label: 'Phase tags & colour coding' },
                  { icon: '◇', label: 'Audio features & intensity scores' },
                  { icon: '◉', label: 'Playlist sync' },
                ].map((b) => (
                  <div key={b.label} className="flex items-start gap-2.5">
                    <span className="text-accent text-[13px] mt-px shrink-0">{b.icon}</span>
                    <span className="text-[12px] text-gray-500 leading-snug">{b.label}</span>
                  </div>
                ))}
              </div>
              <div className="mt-auto pt-5 border-t border-surface-border">
                <span className="text-[11px] text-gray-600 leading-snug block">No account?</span>
                <button
                  type="button"
                  onClick={() => window.open('https://musicforbreathwork.com', '_blank')}
                  className="text-[11px] text-accent hover:text-accent/80 transition-colors underline underline-offset-2 mt-1"
                >
                  musicforbreathwork.com ↗
                </button>
              </div>
            </div>

            {/* Right — form */}
            <div className="flex flex-col flex-1 p-8 gap-6">
              <div className="flex justify-between items-start">
                <div className="flex flex-col gap-1">
                  <span className="text-[16px] font-semibold text-gray-100">Sign in</span>
                  <span className="text-[11px] text-gray-600">Connect your Music for Breathwork account</span>
                </div>
                <button
                  type="button"
                  onClick={() => { setShowModal(false); setError('') }}
                  className="text-gray-600 transition-colors hover:text-gray-400 mt-0.5"
                >
                  <svg className="w-4 h-4" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M2 2l8 8M10 2l-8 8" />
                  </svg>
                </button>
              </div>

              <form onSubmit={handleLogin} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] text-gray-600 uppercase tracking-wider">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus
                    className="h-10 px-3 text-[13px] text-gray-300 bg-surface-hover border border-surface-border rounded outline-none focus:border-accent/50 placeholder-gray-700"
                    placeholder="you@example.com"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] text-gray-600 uppercase tracking-wider">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="h-10 px-3 text-[13px] text-gray-300 bg-surface-hover border border-surface-border rounded outline-none focus:border-accent/50"
                  />
                </div>
                {error && (
                  <p className="text-[11px] text-red-400">{error}</p>
                )}
                <button
                  type="submit"
                  disabled={loading}
                  className="h-11 mt-1 text-[13px] font-medium text-white bg-accent hover:bg-accent/80 rounded transition-colors disabled:opacity-50"
                >
                  {loading ? 'Signing in…' : 'Sign in'}
                </button>
              </form>

              <p className="text-[11px] text-gray-700 leading-relaxed">
                Your Music for Breathwork account gives Library access to the catalogue — phase tags,
                audio features, and playlist data are all pulled from your account.
              </p>
            </div>

          </div>
        </div>
      )}
    </>
  )
}
