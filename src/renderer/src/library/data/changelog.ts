export interface ChangelogEntry {
  version: string
  date: string
  sections: {
    icon: string
    title: string
    items: string[]
  }[]
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '2.4.0',
    date: 'July 2026',
    sections: [
      {
        icon: '✧',
        title: 'Session presets',
        items: [
          'Load curated starting points from the new System Presets list in Session Mode — served live from Music for Breathwork, so they grow without an app update',
        ],
      },
      {
        icon: '↻',
        title: 'Smarter mixing',
        items: [
          'Tracks never repeat within a session — once played, generators won\'t pick them again',
          'A generator won\'t start a fresh song in its final minute, so sections hand over cleanly',
          'Skipping while a crossfade is still in progress no longer drops the audio',
        ],
      },
      {
        icon: '≡',
        title: 'Queue & generators',
        items: [
          'Collapse a tag generator\'s Up Next list, and shuffle just that generator with Random',
          'Drag tracks within a generator to reorder, onto Now Playing to play, or double-click to play now',
          'Type an exact section length (e.g. 8 minutes) as well as cycling the presets',
          'Every generator chip now has a tooltip explaining what it does',
        ],
      },
    ],
  },
  {
    version: '2.3.0',
    date: 'July 2026',
    sections: [
      {
        icon: '↻',
        title: 'Always up to date',
        items: [
          'Matched tracks refresh their audio features and tags from Music for Breathwork in the background — catalogue updates online flow through to your library',
          'A Syncing indicator shows progress; click it to see exactly which tracks are updating, and Cancel anytime',
          'Tags you add yourself are preserved through every sync — only the catalogue\'s own tags are updated, added, or removed',
        ],
      },
      {
        icon: '✧',
        title: 'Session Mode',
        items: [
          'Click the ⓘ on a track in the Available pool to open its full details — audio features, tags, artwork — right beside your mix',
          'A new ✕ in Now Playing clears the current track',
        ],
      },
      {
        icon: '≡',
        title: 'Library',
        items: [
          'Rescan Audio Features now refreshes matched tracks from the catalogue and re-estimates features for everything else, in one cancellable action',
        ],
      },
    ],
  },
  {
    version: '2.0.0',
    date: 'July 2026',
    sections: [
      {
        icon: '⚡',
        title: 'Session Mode',
        items: [
          'A new live mixing view (formerly "Generate") — open it from the Sessions tab → Create session',
          'Plays a seamless, auto-crossfading mix from your library with album art, a live waveform, and transport controls',
          'Move the crossfade-length slider mid-fade and the in-progress crossfade re-times to match',
        ],
      },
      {
        icon: '✧',
        title: 'Shape the sound',
        items: [
          'Filter the track pool by tag (match Any or All)',
          'A 4-band Feel EQ steers the selection by Affective Intensity, Activating Intensity, Tension, and Spaciousness',
          'The pool re-sorts live by how well each track fits',
        ],
      },
      {
        icon: '≡',
        title: 'Up Next & generators',
        items: [
          'Queue specific tracks, or drop in tag generators that keep pulling matching tracks for a set duration',
          'Reorder items, preview what\'s coming next, and let the last generator carry the "tail" when the queue empties',
          'Add an owned Music for Breathwork playlist straight to the queue',
        ],
      },
      {
        icon: '●',
        title: 'Record, replay & templates',
        items: [
          'Record captures the blow-by-blow of a session — the exact tracklist and the changes you make',
          'Saved sessions live in the Sessions tab to replay or export; export any tracklist from the ⋯ menu',
          'Save as Template stores a reusable plan; the Load menu loads either a Template or a Recorded Session',
        ],
      },
      {
        icon: '⇌',
        title: 'Cue-aware crossfades',
        items: [
          'A background scan finds each track\'s intro/outro points so crossfades land on musical moments',
          'Per-track fade points and curves are editable, and folders can be re-scanned on demand',
        ],
      },
      {
        icon: '✦',
        title: 'Around the app',
        items: [
          'A navbar mini-player keeps Session Mode playback visible after you leave the panel',
          'A guided tour appears the first time you open Session Mode — replay it with the ? button',
          'Sidebar tabs reorganised to Tags · Playlists · Sessions · Folders',
        ],
      },
    ],
  },
  {
    version: '1.1.10',
    date: 'July 2026',
    sections: [
      {
        icon: '♪',
        title: 'Windows audio playback fixed',
        items: [
          'Preview and Now Playing audio failed to load on Windows due to how the stream URL handled Windows file paths',
          'Windows paths are now normalised correctly; macOS is unaffected',
        ],
      },
      {
        icon: '⏱',
        title: '"Added" date column',
        items: [
          'New sortable Added column shows when each track was added — sort to find recently added music',
          "Taken from the file's creation date, so it backfills across your library on the next rescan",
        ],
      },
    ],
  },
  {
    version: '1.1.9',
    date: 'May 2026',
    sections: [
      {
        icon: '✦',
        title: "What's New modal",
        items: [
          'Shows automatically on first launch after each update',
          'Lists changes for the current version with previous versions collapsible below',
          'Dismissing saves the version — won\'t appear again until the next update',
        ],
      },
    ],
  },
  {
    version: '1.1.7',
    date: 'May 2026',
    sections: [
      {
        icon: '⇌',
        title: 'Improved crossfade timing on export',
        items: [
          'Tracks without manual cue points now fade in so the fade completes exactly when the outgoing track begins its fade-out',
          'Fade-in includes a 3-second buffer beyond detected content start for a more gradual build',
        ],
      },
    ],
  },
  {
    version: '1.1.6',
    date: 'May 2026',
    sections: [
      {
        icon: '⬚',
        title: 'Layout & UI updates',
        items: [
          'Player bar now spans the full window width',
          'Folder panel footer redesigned with compact two-column grid and Refresh button',
          'Matched count shown in file list footer alongside file count',
          'Tag count shown in tags pane when no tags are selected',
          'Version badge redesigned to match Limina Mix style',
        ],
      },
    ],
  },
  {
    version: '1.1.5',
    date: 'April 2026',
    sections: [
      {
        icon: '♫',
        title: 'Player fix',
        items: [
          'Fixed race condition where switching tracks while audio was playing could cause silence',
        ],
      },
    ],
  },
  {
    version: '1.1.4',
    date: 'April 2026',
    sections: [
      {
        icon: '✦',
        title: 'Now Playing overlay simplified',
        items: [
          'Waveform and time display removed for a cleaner layout focused on album art, track info, and transport',
        ],
      },
    ],
  },
  {
    version: '1.1.3',
    date: 'March 2026',
    sections: [
      {
        icon: '🔗',
        title: 'Re-fetch from MFB fix',
        items: [
          'Re-fetching track data no longer wipes existing MFB metadata when the session token is expired',
          'Re-fetch button is now only shown when logged in',
        ],
      },
    ],
  },
  {
    version: '1.1.2',
    date: 'March 2026',
    sections: [
      {
        icon: '◉',
        title: 'Now Playing overlay',
        items: [
          'Click album art or track name in the player bar to open a full-screen overlay',
          'Large album image, blurred background, waveform, transport controls, and phase/tag chips',
          'Click any tag to filter the file list to that tag',
        ],
      },
    ],
  },
  {
    version: '1.1.1',
    date: 'February 2026',
    sections: [
      {
        icon: '⌕',
        title: 'Search across all playlists',
        items: [
          'Search box in the playlist sidebar finds any track across all your MFB playlists',
          'Results show which playlists contain the track, whether it\'s in your library, and buy links',
          'Playlist tracks can now be dragged to Finder or a DAW',
          '"Show in Library" navigates to the file in the folder view and auto-scrolls to it',
        ],
      },
    ],
  },
  {
    version: '1.1.0',
    date: 'February 2026',
    sections: [
      {
        icon: '🖼',
        title: 'Album art throughout the app',
        items: [
          'Artwork from the MFB catalogue appears in file list rows, player bar, properties panel, and playlist views',
          'Previously-matched files are back-filled silently on next login',
          'Folder right-click context menu with "Show in Finder" and "Remove Folder"',
          'Removed files view now has sortable columns and per-row play buttons',
        ],
      },
    ],
  },
]
