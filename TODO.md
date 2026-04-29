# BreathworkMix — Todo

## In Progress

- [x] Fade in/out drag handles (duration via horizontal drag)
- [x] Fade curve shape via vertical drag on handle (convex ↑ / concave ↓)

## Up Next

- [x] **Resize lane height** — drag handle at bottom of track header
- [x] **Set lane colour** — colour swatch in track header opens native colour picker
- [x] **Live fade updates during playback** — softReload debounces 250ms then reschedules from current position

## Up Next

- [x] Lane volume automation nodes (clip-scoped, not full lane)
- [x] Use keyboard shortcuts to cut and paste
- [x] Save/load session (.limina JSON)
- [x] Change the colours of the VU meter to more closely match the default palette of the clips
- [x] Change the height of the bars in the vu meter to be half the height they are now
- [x] Create a master lane where the volume can be controlled from and remove master volume from right side. Always have the master lane enabled
- [ ] Auto save to project folder at the moment saving to application support
- [x] Undo/redo keyboard shortcuts (Cmd+Z / Cmd+Shift+Z)
- [x] Per-track solo wired to playback engine
- [x] Turn track duration into minutes:seconds
- [x] Remove right click duplicate option
- [x] Add Right click on click context menu with find file in folder

## Backlog

- [x] Fix resolution of wave form display to be more precise
- [x] Drag audio files from Finder onto a track row

- [x] **Master channel** — thin vertical strip on the right, always visible, master gain + output level
- [ ] **VU meters** — per-track and on master; real-time level display using AnalyserNode
