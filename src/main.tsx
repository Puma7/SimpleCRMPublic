import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles/globals.css'
import '@xyflow/react/dist/style.css'
import { RouterProvider } from '@tanstack/react-router'
import { router } from './router'
import { I18nProvider } from './lib/i18n'
import { installStaleAssetReloadHandler } from './stale-asset-reload'

installStaleAssetReloadHandler()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <RouterProvider router={router} />
    </I18nProvider>
  </React.StrictMode>,
)
