import type { TourStep } from './GuidedTour'

/** Guided-tour steps for Session Mode (the MixPanel). Targets are `data-tour`
 *  attributes on MixPanel elements. */
export const SESSION_STEPS: TourStep[] = [
  {
    id: 'session-welcome',
    title: 'Session Mode',
    body: 'This is where you build and play a live, crossfading breathwork mix. Pick a sound, queue it up, and play — Limina blends tracks for you in real time. Click Next or press → to step through.',
    placement: 'center',
  },
  {
    id: 'session-tags',
    title: 'Shape your sound',
    body: 'Filter the available pool by tags, then use the Feel EQ to steer the selection toward more (or less) intensity, tension, activation, and spaciousness. This defines what Limina picks from.',
    target: '[data-tour="session-tags"]',
    placement: 'left',
    spotlight: true,
  },
  {
    id: 'session-queue',
    title: 'Up Next',
    body: 'Add tag "generators" or specific tracks to the queue. Generators keep pulling matching tracks for as long as you like; when the queue empties, Limina keeps going with the last generator (the "tail").',
    target: '[data-tour="session-queue"]',
    placement: 'right',
    spotlight: true,
  },
  {
    id: 'session-transport',
    title: 'Play & crossfade',
    body: 'Play/pause, skip, or trigger the crossfade into the next track early with Fade next. The Xfade slider sets how long transitions take — adjust it live and in-progress fades re-time to match.',
    target: '[data-tour="session-transport"]',
    placement: 'top',
    spotlight: true,
  },
  {
    id: 'session-record',
    title: 'Record the session',
    body: 'Hit Record to capture the blow-by-blow of what you play — the exact tracklist and the changes you make. When you stop, name it and it\'s saved as a Session you can replay or export.',
    target: '[data-tour="session-record"]',
    placement: 'bottom',
    spotlight: true,
  },
  {
    id: 'session-load',
    title: 'Load templates & sessions',
    body: 'Reuse your work from here: Templates are reusable plans (tags, tracks and settings), while Recorded Sessions replay the exact tracklist you captured earlier.',
    target: '[data-tour="session-load"]',
    placement: 'bottom',
    spotlight: true,
  },
  {
    id: 'session-save-template',
    title: 'Save as Template',
    body: 'Happy with the setup? Save the current queue and settings as a Template — a reusable starting point you can load again any time from the Load menu.',
    target: '[data-tour="session-save-template"]',
    placement: 'bottom',
    spotlight: true,
  },
  {
    id: 'session-export',
    title: 'Export & recorded sessions',
    body: 'The ⋯ menu lets you export the current tracklist to your clipboard, or open your recorded sessions to replay, export, or turn one into a Template.',
    target: '[data-tour="session-export"]',
    placement: 'bottom',
    spotlight: true,
  },
  {
    id: 'session-done',
    title: 'That\'s Session Mode',
    body: 'Pick a sound, queue it, press play, and record the ones you love. Reopen this tour any time with the ? button. Close Session Mode to head back to your library.',
    placement: 'center',
  },
]

/** Steps covering Pro-only affordances (recording, templates, loading saved
 *  sessions, export). Filtered out of the tour for free users. */
export const PRO_TOUR_STEP_IDS = new Set([
  'session-record',
  'session-load',
  'session-save-template',
  'session-export',
])
