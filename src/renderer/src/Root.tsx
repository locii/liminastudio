import MixApp from './mix/App'

/**
 * Limina Studio umbrella shell. For now it renders the Mix app unchanged; the
 * Library app and a Home switcher are added in the next steps. Each sub-app
 * keeps its own renderer (components / store / session mode) intact under its
 * namespace — the umbrella only decides which one is on screen.
 */
export default function Root(): JSX.Element {
  return <MixApp />
}
