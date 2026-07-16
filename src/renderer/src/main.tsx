import React from 'react'
import ReactDOM from 'react-dom/client'
import Root from './Root'
import './mix/assets/main.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)

// Stop audio on hot reload so the engine doesn't outlive the React tree
if (import.meta.hot) {
  import.meta.hot.on('vite:beforeUpdate', () => {
    import('./mix/audio/audioEngine').then(({ audioEngine }) => audioEngine.stop())
  })
}
