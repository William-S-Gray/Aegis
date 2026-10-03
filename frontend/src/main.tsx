import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// After a deploy, a tab (or the offline cache) still running the previous
// build asks for page chunks that no longer exist. Reload once to pick up the
// current build; the timestamp stops a loop if the chunk is truly missing.
window.addEventListener('vite:preloadError', (event) => {
  const last = Number(sessionStorage.getItem('aegis:chunk-reload') ?? 0)
  if (Date.now() - last > 10_000) {
    event.preventDefault()
    sessionStorage.setItem('aegis:chunk-reload', String(Date.now()))
    window.location.reload()
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
