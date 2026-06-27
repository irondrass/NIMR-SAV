import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { registerRecipeServiceWorker } from './pwa/registerRecipeServiceWorker'
import './styles/index.css'

/**
 * NIMR SAV v24.0.0-alpha.20 — React recipe entry point
 *
 * Service worker registration is restricted to the isolated recipe path.
 */

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('[NIMR v24] Root element #root not found in DOM.')
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

void registerRecipeServiceWorker()
