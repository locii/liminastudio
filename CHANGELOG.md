# Changelog

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
