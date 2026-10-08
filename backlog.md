# Backlog

Items from the October 2026 review that weren't fixed in the first pass.
Roughly highest-value first within each section. File references are
as of the review and may drift.

## Follow-ups from the new features

- [ ] **Sessions view still lists Recent Mixes.** Recent mixes now live in the Mix Mode dropdown and Cmd+K, so the section in the Sessions view is a duplicate. Remove it, or keep it as the full list.
- [ ] **Allow-list menu channels in the preload.** `onMenu(channel, …)` in `src/preload/index.ts` lets the renderer listen on any IPC channel. Restrict it to the `menu:*` channels the main process actually sends.
- [ ] **Stale folder counts.** `WatchedFolder.fileCount` only refreshes on a full scan (it showed 11,429 for a folder holding 30 tracks). The dropdown and sidebar now count live, so either refresh `fileCount` on rescan or drop the field.
- [ ] **Loudness target as a setting.** Auto-gain targets −16 LUFS (`mix/utils/autoGain.ts`). Some facilitators may prefer quieter sets, e.g. −18 or −20.
- [ ] **Pre-session check for tag generators.** Session Mode's check covers queued tracks and each generator's upcoming tracks, but a long session can draw further from a generator's pool. Consider an option to check the whole pool.
- [ ] **Energy arc for unmatched tracks.** The arc only uses tracks with audio features (Music for Breathwork matches or ReccoBeats estimates); everything else is a gap. Offer to estimate features for a mix's tracks straight from the lane.
- [ ] **Undo for Library health actions.** "Tidy all" duplicates and "Remove missing" are restorable from the removed filter, but not with Cmd+Z.
- [ ] **Release notes.** CHANGELOG.md has an "Unreleased" section; rename it to the version when you tag.

## Security

- [ ] **Sandbox the main window and add a CSP.** Set `sandbox: true` (`src/main/index.ts`, `createWindow`); the preload only uses `contextBridge`, `ipcRenderer` and `webUtils`, which all work sandboxed. Add a Content-Security-Policy meta tag to `src/renderer/index.html`: `default-src 'self'`, connect/media to `http://127.0.0.1:*`, `img-src https: data:`. Electron logs an "Insecure Content-Security-Policy" warning at startup until this is done.
- [ ] **Allow-list paths in IPC handlers.** Several handlers act on any path the renderer sends: `session:saveAs`, `studio:openFile` (calls `shell.openPath`, so it can launch an executable), `file:copyFiles` and `session:collect`. Have main remember paths that came from dialogs or the catalogue and reject anything else. For `studio:openFile`, at minimum check for a `.limina` extension.
- [ ] **Sign Windows builds.** Use Azure Trusted Signing or an EV certificate, and set `win.publisherName` in `electron-builder.yml`. Windows auto-updates aren't Authenticode-verified today.
- [ ] **Narrow macOS entitlements.** Remove `disable-library-validation` and `allow-unsigned-executable-memory` from `build/entitlements.mac.plist` unless something needs them.
- [ ] **Harden CI.** Pin GitHub Actions to commit SHAs instead of `@v2`/`@v4` tags. Move `contents: write` from the whole workflow to the jobs that need it.
- [ ] **Stop building shell strings in `library:findOnDisk`.** It runs `exec` with a command string (`scanHandlers.ts`); switch to `execFile` with an argument array. `safe()` strips the main metacharacters, but `%VAR%` still expands on Windows.
- [ ] **OAuth callback.** In `authHandlers.ts`, ignore requests to `/callback` whose state doesn't match instead of aborting the sign-in, so a local page can't cancel it. Check `safeStorage.isEncryptionAvailable()` before storing tokens.
- [ ] **Validate API inputs and responses.** Integer-check the `id` passed to `auth:getPlaylist` and `presets:delete`. Validate the shape of MFB API JSON instead of `as` casts. Stop logging raw playlist responses.
- [ ] **Deny permission requests.** Add a `session.setPermissionRequestHandler` that refuses microphone, camera, geolocation and so on.
- [ ] **ReccoBeats disclosure.** 30-second clips of local audio are uploaded to `api.reccobeats.com` (`libraryAudioHandlers.ts`). Tell users, or make it opt-in.
- [ ] **Git history.** `May 26 Breathwork.limina` (local Dropbox paths) is untracked now but still in history. Rewrite history only if that matters.

## Performance

- [ ] **Timeouts on other ffmpeg spawns.** Duration probes, feature and cue analysis, and the metadata fallback (`libraryAudioHandlers.ts`, `fileHandlers.ts`) have no timeout and can hang on online-only cloud files. The audio-server leak is fixed. Separately, the copy of Limina Studio installed in /Applications had been open for 31 days and was holding 16 stuck ffmpeg processes; quitting it clears them.
- [ ] **One ffmpeg pass per file.** Loudness (`audio:getLoudness`) decodes each file separately from the waveform peaks. Both are cached, but the first open of a session still decodes everything twice. Measure both in one pass, and return peaks as a `Float32Array` rather than `number[]`. `audio:getPeakLevel` is now unused by Mix.
- [ ] **Faster time ruler.** `TimeRuler.tsx` renders about 10,000 tick `<div>`s at default zoom for a 3-hour set. That only happens on zoom changes now, but a canvas would be much cheaper.
- [ ] **Memoise timeline rows.** Wrap `TimelineTrack`, `ClipBlock` and `TrackHeader` in `React.memo`, and pass stable callbacks from `Timeline/index.tsx` instead of inline arrow functions.
- [ ] **Narrow Auto-Mix selectors.** `MixPanel.tsx` and `SessionTransportBar.tsx` select the whole `mixPlayback` object. It now updates at about 15Hz rather than 60, but selecting only the fields used would cut that further.
- [ ] **Batch background scan writes.** Cue and feature scans call `updateFile` once per file, and each call copies the whole `files` array and schedules a catalogue save. Apply results in batches.
- [ ] **Release warmup elements.** The Mix warmup pool (`audioEngine.ts`) keeps a `preload=auto` element alive for every file until playback starts.
- [ ] **Bundle size.** Library and Mix ship in a single 1.3MB chunk; lazy-load each workspace in `Root.tsx`. `limina-logo.png` is 920KB.
- [ ] **Clip start timing.** Mix starts clips with `setTimeout` + `audio.play()`. Gain snaps hide the jitter, and background throttling is now off, but scheduling against the audio clock would be more robust.

## Interface

- [ ] **Keyboard-accessible rows.** Clickable rows in `FileList.tsx` and `PlaylistsSurface.tsx` are `<div onClick>` elements with no role or tabIndex. Make them reachable and operable from the keyboard.
- [ ] **Small text sizes.** About 390 uses of `text-[9px]` and `text-[10px]`. Contrast was raised one step in this pass, but consider an 11px minimum for anything people need to read.
- [ ] **Hard-coded colours.** About 200 hex literals in TSX bypass the `surface-*` and `accent` tokens.
- [ ] **Remaining dialogs.** Move `KeyboardShortcuts`, `ReindexDialog`, `SpotifyImportModal` and `WhatsNewModal` onto `useDialog`; they already handle Escape but don't trap focus.
- [ ] **Undo for Remove Folder.** It now asks for confirmation; a restorable soft-delete, like single-track removal, would be friendlier.
- [ ] **Guided tour on Collections.** During testing, the Collections tour reappeared at step 1 on every visit. Check that completion or skip is being saved.

## Code health

- [ ] **Tests.** There's no test runner. Add Vitest and start with pure logic: crossfade computation, `mixEngine`, the `.sesx`/Audacity importers, `libraryStore` filters, `parseChangelog` and `isInFolder`.
- [ ] **Linting.** There's no ESLint config, although the code has six `eslint-disable` comments. Add `@electron-toolkit/eslint-config-ts` and the react-hooks plugin.
- [ ] **Large components.** Move logic into hooks and stores, as CLAUDE.md asks:
  - `MixPanel.tsx` (1,700 lines, 40 `useState`)
  - `FileList.tsx` (1,380)
  - `PropertiesPanel.tsx` (1,135)
  - `PlaylistsSurface.tsx` (1,130)
  - `mix/App.tsx` (1,020, with about 60 `window.electronAPI` calls)
- [ ] **Keyboard handling.** There are about 20 separate `window` keydown listeners. Replace them with one input-aware `useKeyboardShortcuts` hook per workspace; `isEditableFocused()` already exists to build on.
- [ ] **Duplicated logic.**
  - Two `GuidedTour` components could become one that takes its steps as a prop.
  - Rename the two `PropertiesPanel`s by what they do (track vs clip).
- [ ] **Rewrite CLAUDE.md.** It still describes "BreathworkMix", the Phase 1–3 plan, and files that no longer exist. Document the real `library/` + `mix/` + umbrella layout, the IPC surface and the `src/shared` types. `TODO.md` is also stale.
- [ ] **Dependency upgrades.**
  - electron-builder 24 → 26
  - electron-vite 2 → 5 (with Vite 5 → 8)
  - zustand 4 → 5
  - React 18 → 19
  - Tailwind 3 → 4

  Do each separately, with a test pass between them.
