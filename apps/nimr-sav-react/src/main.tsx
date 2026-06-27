import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import './styles/index.css'

/**
 * NIMR SAV v24.0.0-alpha.19 — React entry point
 *
 * NO service worker registration here.
 * Reserved cache name: nimr-sav-react-v24-alpha (future use only)
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
