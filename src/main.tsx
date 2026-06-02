import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles/globals.css'
import '@xyflow/react/dist/style.css'
import { RouterProvider } from '@tanstack/react-router'
import { router } from './router'
import { installStaleAssetReloadHandler } from './stale-asset-reload'

installStaleAssetReloadHandler()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
)
