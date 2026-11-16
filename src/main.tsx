import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import '@fontsource/inter/400.css'
import '@fontsource/inter/400-italic.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/inter/700-italic.css'
import '@fontsource/literata/400.css'
import '@fontsource/literata/400-italic.css'
import '@fontsource/literata/700.css'
import '@fontsource/literata/700-italic.css'
import '@fontsource/courier-prime/400.css'
import '@fontsource/courier-prime/400-italic.css'
import '@fontsource/courier-prime/700.css'
import '@fontsource/courier-prime/700-italic.css'
import './styles/theme.css'
import { registerSW } from 'virtual:pwa-register'
import { AppRoutes } from './App'
import { announceUpdate, UpdateNotice } from './app/UpdateNotice'
import { SyncProvider } from './sync/SyncProvider'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <SyncProvider>
        <AppRoutes />
        <UpdateNotice />
      </SyncProvider>
    </HashRouter>
  </React.StrictMode>,
)

// Offline use and installation. A new version is offered, never forced.
if ('serviceWorker' in navigator) {
  const applyUpdate = registerSW({
    onNeedRefresh() {
      announceUpdate(() => void applyUpdate(true))
    },
  })
}
