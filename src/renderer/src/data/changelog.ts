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
    version: '0.9.4',
    date: 'May 2026',
    sections: [
      {
        icon: '✦',
        title: "What's New modal",
        items: [
          'Shows automatically on first launch after an update',
          'Lists changes for the current version with previous versions collapsible below',
        ],
      },
      {
        icon: '♫',
        title: 'Export quality',
        items: [
          'WAV exports are now 24-bit (up from 16-bit) for full dynamic range',
        ],
      },
    ],
  },
  {
    version: '0.9.3',
    date: 'May 2026',
    sections: [
      {
        icon: '⬚',
        title: 'Marquee selection',
        items: [
          'Drag on empty timeline space to rubber-band select clips',
          'Clips highlight in real time as the rect sweeps over them',
          'Click empty space to deselect all',
        ],
      },
      {
        icon: '⇅',
        title: 'Multi-clip cross-track drag',
        items: [
          'Multi-selected clips can now be dragged across tracks as a group',
          'Cmd/Ctrl+A selects all clips without opening the properties panel',
          'Shift-click, trim, and fade handles no longer accidentally open properties',
        ],
      },
      {
        icon: '♫',
        title: 'Export quality',
        items: [
          'WAV exports are now 24-bit (up from 16-bit) for full dynamic range',
        ],
      },
      {
        icon: '⌨',
        title: 'Keyboard & zoom',
        items: [
          'Cmd/Ctrl+X works with marquee and multi-select',
          'Zoom keys now anchor on the visible viewport, not the playhead',
          'Waveforms no longer lag behind during rapid zoom',
        ],
      },
    ],
  },
  {
    version: '0.9.2',
    date: 'May 2026',
    sections: [
      {
        icon: '🔗',
        title: 'Library re-linking',
        items: [
          'Re-link from Library now works reliably for all clip types',
          'Album art and metadata refresh correctly after re-linking',
        ],
      },
    ],
  },
  {
    version: '0.9.0',
    date: 'April 2026',
    sections: [
      {
        icon: '✦',
        title: 'Clip interaction redesign',
        items: [
          'Properties panel opens via the clip label icon, not on every click',
          'Fade handles draggable directly on the clip with curve control',
          'Split at playhead via right-click context menu or S key',
        ],
      },
    ],
  },
]
