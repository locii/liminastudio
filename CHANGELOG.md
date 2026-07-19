# Changelog

## v1.0.4

- **Open the indexing log any time** — The Music for Breathwork indexing log used to be reachable only while indexing was actively running; once it finished, there was no way back in to review what matched. It now lives in your account menu (top-right, when signed in), so you can reopen it whenever you like — with a count of any matches still waiting to be applied.
- **Library keeps itself in sync with your folders** — Limina now rescans your watched folders automatically when it finishes loading and each time you bring the window back into focus. Files you added while the app was closed or in the background show up on their own — no manual rescan needed. It's a cheap diff that only reads genuinely new files, and nothing you or the catalogue curated is touched.
- **Signing in is clearly optional** — The Music for Breathwork sign-in dialog now marks itself "optional" and offers a plain "Skip for now" button, so it's obvious you can go straight to working with your own files without an account.

## v1.0.3

- **Drag from Up Next straight to Now Playing** — You can once again drag a track out of the Up Next queue and drop it onto the Now Playing area to play it immediately. Limina fades to that track and skips ahead, discarding anything queued before it — the same as double-clicking it.
- **Larger sign-in window** — The Music for Breathwork sign-in dialog was cramped against the app window. It's now bigger, with more readable text and roomier fields.

## v1.0.2

- **Returning users no longer see the new-user setup on launch** — Limina Studio opens on Home, but your library and sign-in were only restored once you visited the Library screen. On restart that left Home briefly showing the "sign in / add music" onboarding steps even though a real library and login already existed. The catalogue and session are now loaded up front, so your library and account are recognised immediately on every launch.

## v1.0.1

- **Collections — track details & find-on-disk** — Click any track in a playlist, template, or recorded session to open its details panel. A playlist track that isn't in your library yet opens a panel where you can search your disk and link the local file.
- **Fixed "Show in Library"** — Right-clicking a playlist track and choosing "Show in Library" now reliably switches to the Library and reveals the track, instead of blanking the view.
- **Session Mode** — The tag / Feel-EQ "Add to queue" button now matches the playlist button's style and sits neatly to the right of its row.

## v1.0.0

**Limina Studio 1.0 — your library, session player, and multitrack mixer, unified.**

Limina Mix is now part of **Limina Studio**: one app that takes you from an unorganised folder of audio files all the way to a finished breathwork set. Your existing library and sessions carry over automatically on first launch — nothing to re-scan or re-match.

### One app, four workspaces

- **Library** — Point Limina at your music folders and it scans, organises, and matches your tracks against the Music for Breathwork catalogue, unlocking phase tags, colour coding, and audio features. Drop a folder in, and matching runs in the background.
- **Session Mode** — Run a live, tag-driven set with automatic equal-power crossfades. Steer the mix by tags and feel, skip and reshape on the fly, and record what you play to replay or refine later.
- **Mix Mode** — Everything the standalone Limina Mix did, now under the same roof: arrange tracks on a timeline, set crossfades, and export a single finished audio file.
- **Collections** — Your Music for Breathwork playlists, session templates, recorded sessions, and saved mixes, all in one place.

### Guided onboarding

- New users are eased in step by step: connect a Music for Breathwork account (optional — you can skip it), add a music folder by drag-and-drop, apply catalogue matches, then try Session and Mix Mode.

### Moving over from Limina Mix or Limina Library

- On first launch, Limina Studio automatically imports your existing library from the previous app. Your folders, matches, tags, and recorded sessions come with you.

### Also in this release

- Recorded sessions now live in Collections with full session timelines, tracklist export, and "save as template".
- Collections remembers the last playlist, template, or session you were viewing.
- Plus the accumulated fixes and refinements from the 0.9.x line.

## v0.9.5

- **Windows audio playback fixed** — Clip playback and preview produced no sound on Windows because the internal audio stream URL was built assuming a Unix-style file path, so the drive letter fused onto the server port and backslashes corrupted the path. Windows paths are now normalised correctly. macOS is unaffected.

## v0.9.2

- **Library re-linking improvements** — Clips that couldn't be matched to Limina Library (because files were moved, duplicates removed, or exported as WAV) now auto-link on session load. Matching is extension-agnostic, handles apostrophe stripping, and recognises WAV exports with sample-rate suffixes (e.g. `48000 1`).
- **Re-link from Library** — New right-click option on any clip to manually trigger a Library lookup.

## v0.9.0

- **Clip interaction redesign** — Double-click or click the label pill to open clip properties. Album art thumbnail shown in the clip label when available. Properties no longer open on single click, eliminating accidental panel opens during drag.

## v0.8.5

- **Transport bar height fix** — The bottom transport bar was too short after the v0.8.3 redesign. Height restored to 66px with a larger album art thumbnail.

## v0.8.4

- **Audio playback fix** — Suppressed a spurious console error that appeared when seeking or stopping while a clip was loading. The `AbortError` from interrupting a pending `play()` call is expected behaviour and no longer logged.

## v0.8.3

- **Properties panel redesigned** — Clip properties now open as a right-side drawer that slides in when you click a clip, rather than a fixed strip at the bottom. More vertical space means album art, track info, gain controls, and MFB data all have room to breathe. Drag a clip without it opening; only a deliberate click opens the panel.
- **Library integration** — When a file is added or dragged into Mix, it is automatically looked up against Limina Library's catalogue. If the track has been matched in Library, its MFB title, artist, album art, tags, and breathwork phase are applied to the clip immediately with no extra steps.
- **Find on MFB** — For clips not in Library, the properties panel now has a "Find on MFB" button. It pre-fills a search from the filename and lets you pick the correct track from results. No login required to search.
- **Transport bar redesigned** — True three-column layout: time display and album art thumbnail on the left, transport buttons perfectly centred, master volume on the right. The thumbnail is clickable to open the Now Playing overlay.
- **Version and update status in transport bar** — The version number sits at the bottom right of the transport bar. Click it to check for updates; it shows checking, up to date, download progress, and a restart prompt when an update is ready. Update status is also in File → Check for Updates.

## v0.8.2

- **Open Recent** — File menu now lists recently opened sessions with full path tooltips.

## v0.8.1

- **Sharper waveforms** — Waveform extraction now reads at 48 kHz (was 8 kHz) and renders a true two-sided min/max envelope. Fade-ins and quiet passages no longer look quantized into blocky steps. Memory stays bounded regardless of clip length thanks to a streaming bucket extractor.
- **File → Rebuild Waveforms** — New menu item clears every cached waveform in the session and re-extracts at the current zoom. Useful after the resolution upgrade above, or any time a waveform looks wrong.
- **File → Export Waveform Data…** — Dump the cached peak data for every clip (with file metadata) to a JSON file for troubleshooting. One file, easy to share.

## v0.8.0

- **Markers removed** — Markers have been removed from the timeline. Segments cover the same organisational need with a cleaner workflow; use segments to label and divide your session.
- **Tracklist PDF grouped by segment** — The PDF export now groups tracks under their containing segment, with H:MM:SS timestamp display for sessions longer than an hour.

## v0.7.9

- **Mac auto-update fixed** — Earlier Mac builds shipped only the `.dmg`, but macOS's auto-updater (Squirrel.Mac) needs a `.zip` of the `.app` bundle to apply updates. Releases now ship both, so updates download and install correctly instead of hanging on "Downloading update…" forever. If you've been stuck on a frozen update spinner, fully quit Limina Mix (Cmd-Q) and relaunch — the next check will succeed.
- **Manual "Check for updates" button** — Added in v0.7.8; combined with the v0.7.9 fix it now does what it says on the tin.
