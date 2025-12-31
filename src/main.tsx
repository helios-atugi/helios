// src/main.tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

window.addEventListener('error', (event) => {
  console.error('[window.error]', event.error || event.message, event)
})

window.addEventListener('unhandledrejection', (event) => {
  console.error('[unhandledrejection]', event.reason, event)
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  // <React.StrictMode> ← いったん外す
  <App />,
  // </React.StrictMode>
)
