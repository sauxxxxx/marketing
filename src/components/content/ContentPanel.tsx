import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useBlocker } from 'react-router-dom'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import type { ContentInsert } from '@/types/database'
import { ContentEditor } from './ContentEditor'

export type ContentDefaults = Partial<Omit<ContentInsert, 'workspace_id'>>

type PanelState = { mode: 'edit'; id: string } | { mode: 'create'; defaults: ContentDefaults } | null

interface ContentPanelValue {
  isOpen: boolean
  openContent: (id: string) => void
  createContent: (defaults?: ContentDefaults) => void
}

const ContentPanelContext = createContext<ContentPanelValue | null>(null)

/**
 * One editor for the whole app: calendar, board, library, plans and overview
 * all open the same panel, so every view edits the same record the same way.
 */
export function ContentPanelProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PanelState>(null)
  const [dirty, setDirty] = useState(false)
  const [pendingClose, setPendingClose] = useState<null | (() => void)>(null)

  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname)

  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  const guard = useCallback(
    (action: () => void) => {
      if (dirty) setPendingClose(() => action)
      else action()
    },
    [dirty],
  )

  const value = useMemo<ContentPanelValue>(
    () => ({
      isOpen: state !== null,
      openContent: (id) => guard(() => setState({ mode: 'edit', id })),
      createContent: (defaults = {}) => guard(() => setState({ mode: 'create', defaults })),
    }),
    [guard, state],
  )

  const close = () => {
    setDirty(false)
    setState(null)
  }

  return (
    <ContentPanelContext.Provider value={value}>
      {children}
      <Sheet open={!!state} onOpenChange={(open) => !open && guard(close)}>
        <SheetContent
          side="right"
          showCloseButton={false}
          className="flex w-full flex-col gap-0 p-0 sm:max-w-[680px]"
          onEscapeKeyDown={(e) => {
            if (dirty) {
              e.preventDefault()
              guard(close)
            }
          }}
        >
          <SheetTitle className="sr-only">{state?.mode === 'create' ? 'New content' : 'Content details'}</SheetTitle>
          <SheetDescription className="sr-only">Create or edit a content item.</SheetDescription>
          {state && (
            <ContentEditor
              key={state.mode === 'edit' ? state.id : 'new'}
              itemId={state.mode === 'edit' ? state.id : null}
              defaults={state.mode === 'create' ? state.defaults : undefined}
              onDirtyChange={setDirty}
              onClose={close}
              onCreated={(id) => {
                setDirty(false)
                setState({ mode: 'edit', id })
              }}
              onReuse={(defaults) => guard(() => setState({ mode: 'create', defaults }))}
            />
          )}
        </SheetContent>
      </Sheet>
      <ConfirmDialog
        open={!!pendingClose || blocker.state === 'blocked'}
        onOpenChange={(open) => {
          if (!open) {
            setPendingClose(null)
            if (blocker.state === 'blocked') blocker.reset()
          }
        }}
        title="Discard unsaved changes?"
        description="Your edits to this content item haven’t been saved."
        confirmLabel="Discard changes"
        destructive
        onConfirm={() => {
          setDirty(false)
          if (blocker.state === 'blocked') {
            setState(null)
            blocker.proceed()
          } else {
            pendingClose?.()
          }
          setPendingClose(null)
        }}
      />
    </ContentPanelContext.Provider>
  )
}

export function useContentPanel(): ContentPanelValue {
  const ctx = useContext(ContentPanelContext)
  if (!ctx) throw new Error('useContentPanel must be used inside ContentPanelProvider')
  return ctx
}
