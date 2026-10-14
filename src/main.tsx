import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { WorkspaceProvider } from '@/features/workspace/WorkspaceProvider'
import { ConfigErrorPage } from '@/features/auth/NoAccessPage'
import { isPermissionError } from '@/lib/errors'
import { readEnv } from '@/lib/env'
import { router } from '@/app/router'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, error) => count < 2 && !isPermissionError(error),
    },
  },
})

const { missing } = readEnv()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {missing.length > 0 ? (
      <ConfigErrorPage missing={missing} />
    ) : (
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <WorkspaceProvider>
            <TooltipProvider delayDuration={300}>
              <RouterProvider router={router} />
            </TooltipProvider>
          </WorkspaceProvider>
        </AuthProvider>
        <Toaster position="bottom-right" closeButton />
      </QueryClientProvider>
    )}
  </StrictMode>,
)
