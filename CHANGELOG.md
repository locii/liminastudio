# Changelog

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
