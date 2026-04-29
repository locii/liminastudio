# BreathworkMix — Claude Code Project Context

## What This App Is

A desktop multitrack audio editor built for Holotropic Breathwork facilitators.
Users load music tracks, arrange them on a timeline, set crossfades between
clips, preview the full mix, and export as a single audio file.

Think: slimmed-down Adobe Audition, purpose-built for 3-hour breathwork sets.

## Tech Stack

- Electron (v28+) — desktop shell, filesystem, ffmpeg
- React 18 + TypeScript — all UI lives in renderer
- electron-vite — dev server and build tooling
- WaveSurfer.js (v7) — waveform rendering
- Tone.js (v14) — audio engine, scheduling, crossfades
- ffmpeg-static — bundled ffmpeg binary (no system dependency)
- Tailwind CSS — styling (dark theme only)
- Zustand — global state (session, transport, UI state)

## Project Structure

src/
main/
index.ts # Electron main process entry
ipc/
fileHandlers.ts # File open, save, export dialogs
audioHandlers.ts # Waveform peak extraction
ffmpegHandlers.ts # Mixdown and encode
ffmpeg.ts # ffmpeg-static wrapper utilities
preload/
index.ts # contextBridge IPC definitions
renderer/
main.tsx # React entry point
App.tsx
components/
TransportBar/
TrackHeader/
Timeline/
ClipBlock/
CrossfadeHandle/
PropertiesPanel/
WaveformDisplay/
store/
sessionStore.ts # Zustand: tracks, clips, session
transportStore.ts # Zustand: playhead, playing, zoom
audio/
audioEngine.ts # Single AudioContext, Tone.js setup
scheduler.ts # Clip playback scheduling
crossfade.ts # Equal-power crossfade logic
hooks/
useAudioEngine.ts
useTimeline.ts
useKeyboardShortcuts.ts
types/
index.ts # All shared TypeScript types

## Core Data Model — Never Change Without Noting It Here

```typescript
interface Session {
  id: string;
  name: string;
  tracks: Track[];
  clips: Clip[];
  timeline: TimelineState;
  createdAt: string;
  updatedAt: string;
}

interface Track {
  id: string;
  name: string;
  color: string; // hex, for waveform tinting
  volume: number; // 0–1
  muted: boolean;
  solo: boolean;
  order: number;
}

interface Clip {
  id: string;
  trackId: string;
  filePath: string;
  fileName: string;
  startTime: number; // seconds on the timeline (left edge)
  duration: number; // full file duration
  trimStart: number; // seconds trimmed from file start
  trimEnd: number; // seconds trimmed from file end
  fadeIn: number; // seconds
  fadeOut: number; // seconds
  volume: number; // 0–1, clip-level gain
}

interface TimelineState {
  zoom: number; // pixels per second (default: 10)
  scrollX: number; // pixels scrolled from left
  duration: number; // total session length in seconds
}

interface TransportState {
  playhead: number; // seconds
  playing: boolean;
  looping: boolean;
  loopStart: number;
  loopEnd: number;
}
```

## IPC Contract — Renderer ↔ Main

All calls go through contextBridge. Never use nodeIntegration.

```typescript
// Exposed as window.electronAPI
{
  // File operations
  openAudioFiles: () => Promise<AudioFileMeta[]>
  saveSession: (session: Session) => Promise<string>  // returns path
  loadSession: () => Promise<Session | null>

  // Audio processing (main process, off UI thread)
  getWaveformPeaks: (filePath: string, samplesPerPixel: number)
    => Promise<number[]>
  getAudioMetadata: (filePath: string)
    => Promise<{ duration: number; sampleRate: number; channels: number }>

  // Export
  exportMix: (exportConfig: ExportConfig) => Promise<string>
  onExportProgress: (callback: (pct: number) => void) => void
}

interface AudioFileMeta {
  path: string
  name: string
  duration: number
  sampleRate: number
  channels: number
}

interface ExportConfig {
  clips: Clip[]
  tracks: Track[]
  outputPath: string
  format: 'wav' | 'mp3'
  sampleRate: 44100 | 48000
  bitrate?: 128 | 192 | 320   // MP3 only
}
```

## Audio Engine Rules

1. ONE AudioContext for the entire app — created once in audioEngine.ts,
   never recreated
2. All clips scheduled against AudioContext.currentTime — never use
   setTimeout for audio timing
3. Waveform peaks are fetched via IPC (main process decodes with ffmpeg)
   — never decode in the renderer for display purposes
4. Playback uses Tone.js Players scheduled on the transport
5. Crossfades use equal-power curves (not linear) — see crossfade.ts
6. On stop: cancel all scheduled sources, don't destroy the AudioContext

## Timeline Rules

1. Pixels-per-second = zoom value (default 10px/s, range 2–100)
2. Clip position: clip.startTime \* zoom = left offset in pixels
3. Clip width: (clip.duration - clip.trimStart - clip.trimEnd) \* zoom
4. Crossfade overlap: when two clips on the same track overlap,
   the overlap region IS the crossfade — no separate UI element needed
5. Minimum clip length after trimming: 1 second
6. Snap to: other clip edges, playhead, grid (every 5s by default)

## UI/UX Rules

- Dark theme throughout — background #0f0f0f, panels #1a1a1a,
  borders #2a2a2a, accent #6366f1 (indigo)
- Waveforms: filled, colour-tinted per track, progress overlay slightly
  lighter than base colour
- Selected clip: accent border + subtle glow
- Hover states on all interactive elements
- Keyboard shortcuts:
  - Space: play/stop
  - R: return to start
  - L: toggle loop
  - Cmd/Ctrl+Z: undo (implement basic undo stack)
  - Cmd/Ctrl+S: save session
  - Cmd/Ctrl+E: open export dialog
  - Delete: remove selected clip
  - +/-: zoom in/out

## What NOT To Do

- Do not use nodeIntegration: true — always IPC
- Do not decode full audio buffers in renderer for waveform display
- Do not use inline styles — Tailwind classes only
- Do not create multiple AudioContext instances
- Do not put business logic in components — hooks and stores only
- Do not skip TypeScript types — every function must be typed
- Do not use any — use unknown and narrow it

## Build Phases

### ✅ Phase 1 — COMPLETE WHEN CONFIRMED

- Electron window opens with dark UI
- Add Track button → file dialog → loads WAV/MP3
- Track appears with waveform rendered via WaveSurfer
- Basic play/stop transport with playhead

### 🔲 Phase 2 — DO NOT START UNTIL PHASE 1 CONFIRMED

See: PHASE2_PROMPT.md

### 🔲 Phase 3 — DO NOT START UNTIL PHASE 2 CONFIRMED

See: PHASE3_PROMPT.md

## Known Issues & Decisions Log

(Claude Code: append to this section when you make an architectural
decision or hit a limitation)

- [date] Decision: using ffmpeg-static over system ffmpeg for portability

PHASE2_PROMPT.md — paste this into Claude Code when Phase 1 is done:
markdown# Phase 2: Timeline, Clips & Crossfades

Phase 1 is confirmed working. Now build Phase 2.
Read CLAUDE.md fully before writing any code.

## Goals

1. Clips rendered as draggable blocks on a pixel-based timeline
2. Crossfade when clips overlap on the same track
3. Zoom control
4. Selected clip properties in the panel

## Task List — implement in this order, confirm each before next

### 2.1 — Timeline Canvas

- Horizontal scrollable timeline area below track headers
- Time ruler at top (marks every 5s, labels every 30s)
- Playhead as a vertical red line that moves during playback
- Grid lines every 5 seconds (subtle, #1f1f1f)
- Zoom: +/- buttons and keyboard shortcuts change px/s,
  timeline re-renders accordingly
- Clicking the timeline moves the playhead

### 2.2 — Clip Blocks

- Each clip renders as a coloured block on its track row
- Position: clip.startTime \* zoom px from left
- Width: (duration - trimStart - trimEnd) \* zoom px
- Shows: waveform (WaveSurfer peaks already fetched),
  file name label top-left, fade-in/fade-out triangles
- Drag horizontally to change startTime (snap to grid + other clips)
- Right-click context menu: Remove Clip, Duplicate, Properties
- Click to select (highlight with accent border)

### 2.3 — Crossfade Logic

When two clips on the same track overlap:

- Calculate overlap duration: overlapDuration =
  (clip1.startTime + clip1.effectiveDuration) - clip2.startTime
- Clamp to min 0.1s, max half the shorter clip's duration
- Store as clip1.fadeOut = overlapDuration, clip2.fadeIn = overlapDuration
- Render crossfade zone: diagonal lines pattern over the overlap region
- In the audio engine, apply equal-power curves (see crossfade.ts)
- Equal power formula:
  gainA = Math.cos(t _ 0.5 _ Math.PI) // t: 0→1 over fade
  gainB = Math.cos((1 - t) _ 0.5 _ Math.PI)

### 2.4 — Properties Panel

When a clip is selected, the bottom panel shows:

- File name (read only)
- Track (dropdown to move clip to another track)
- Start time (editable number input, in seconds)
- Fade in duration (seconds, 0 to half clip length)
- Fade out duration (seconds, 0 to half clip length)
- Clip volume (slider 0–100%)
- All fields update the Zustand store on change
- Changes reflect immediately in timeline and audio engine

### 2.5 — Playback with Timeline Clips

Update the audio scheduler to:

- Read all clips from the session store
- For each clip, schedule a Tone.Player at the correct
  AudioContext time offset
- Apply clip.volume as a GainNode
- Apply fade curves using Tone.js automation:
  player.volume.rampTo(-Infinity, fadeIn) // fade in
- Respect clip.trimStart: player.start(when, clip.trimStart)
- On stop: dispose all players cleanly

## Definition of Done for Phase 2

- [ ] Can load 3+ audio files as clips on different tracks
- [ ] Can drag clips to different positions on the timeline
- [ ] Overlapping clips on the same track crossfade correctly on playback
- [ ] Zoom in/out works, waveforms remain accurate
- [ ] Selecting a clip shows correct values in properties panel
- [ ] Editing properties panel values updates playback behaviour
- [ ] No AudioContext warnings in console
- [ ] No TypeScript errors

PHASE3_PROMPT.md — for when Phase 2 is solid:
markdown# Phase 3: Export, Save/Load & Polish

Phase 2 is confirmed working. Now build Phase 3.
Read CLAUDE.md fully before writing any code.

## Goals

1. Export the mix to WAV or MP3
2. Save and load sessions as JSON
3. Keyboard shortcuts
4. General polish and stability

## Task List

### 3.1 — Session Save/Load

- Cmd/Ctrl+S → save session as JSON file (via IPC saveSession)
- On load (Cmd/Ctrl+O or welcome screen) → IPC loadSession →
  restore full session state including all clips and timeline position
- Recent sessions list (store last 5 paths in electron-store)
- On app open with no session: show a welcome screen with
  "New Session" and "Open Recent" options
- Session JSON includes all Clip and Track data — file paths are
  absolute, warn user if a file is missing on load

### 3.2 — Export

Cmd/Ctrl+E opens export dialog:

- Output format: WAV (uncompressed) or MP3
- If MP3: bitrate selector (128 / 192 / 320 kbps)
- Sample rate: 44100 or 48000 Hz
- Output file picker
- "Export" button triggers IPC exportMix

In main process (ffmpegHandlers.ts):

- Use OfflineAudioContext to render the full mix to an AudioBuffer
  (or use ffmpeg directly with filter_complex for mixing —
  prefer ffmpeg approach for long files to avoid memory issues)
- ffmpeg approach:
  1. Write each clip's timing to an ffmpeg filter_complex command
  2. Use adelay, afade, apad, and amix filters
  3. Stream output — do not buffer entire file in memory
- Send progress events back to renderer via IPC onExportProgress
- Show progress bar in export dialog during render

### 3.3 — Undo/Redo

- Implement a simple undo stack in Zustand
- Actions that are undoable: move clip, delete clip, add clip,
  change fade, change volume
- Max stack depth: 50
- Cmd/Ctrl+Z: undo, Cmd/Ctrl+Shift+Z: redo
- Show current action name in a small toast when undone

### 3.4 — Keyboard Shortcuts

Implement all shortcuts from CLAUDE.md:

- Space: play/stop
- R: return playhead to 0
- L: toggle loop
- Delete/Backspace: delete selected clip
- +/-: zoom timeline
- Cmd/Ctrl+S: save
- Cmd/Ctrl+E: export
- Cmd/Ctrl+Z/Shift+Z: undo/redo
- Escape: deselect clip

### 3.5 — Polish

- Loading state when waveform peaks are being fetched
  (spinner inside clip block)
- Toast notifications for: session saved, export complete,
  file not found on load
- Drag audio files from Finder/Explorer directly onto a track row
  (use Electron's will-navigate + webContents drop events)
- App menu (File, Edit, View) with all major actions
- About dialog with version number
- Window title: "[Session Name] — BreathworkMix"
- Dirty state indicator: asterisk in title when unsaved changes exist

## Definition of Done for Phase 3

- [ ] Can save a session and reopen it with all clips intact
- [ ] Export to WAV produces a correctly mixed audio file
- [ ] Export to MP3 produces a correctly mixed audio file
- [ ] Progress bar shows during export
- [ ] Undo/redo works for clip moves and deletions
- [ ] All keyboard shortcuts work
- [ ] Drag-and-drop files onto tracks works
- [ ] No console errors in production build
- [ ] App builds and runs as a distributable (electron-builder)
