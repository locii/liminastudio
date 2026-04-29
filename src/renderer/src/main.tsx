import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './assets/main.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

// Stop audio on hot reload so the engine doesn't outlive the React tree
if (import.meta.hot) {
  import.meta.hot.on('vite:beforeUpdate', () => {
    import('./audio/audioEngine').then(({ audioEngine }) => audioEngine.stop())
  })
}
