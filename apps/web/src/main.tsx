import '@repo/i18n'
import { TooltipProvider } from '@repo/ui'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'

import { router } from './router'
import './styles/index.css'

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    <TooltipProvider delayDuration={350}>
      <RouterProvider router={router} />
    </TooltipProvider>
  </StrictMode>,
)
