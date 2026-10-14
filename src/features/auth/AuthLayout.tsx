import type { ReactNode } from 'react'
import { Logo } from '@/components/common/Logo'

export function AuthLayout({ title, description, children, footer }: { title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-[400px]">
          <Logo className="mb-8" />
          <div className="rounded-lg border bg-card p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
            <h1 className="text-xl font-semibold">{title}</h1>
            {description && <div className="mt-1 text-sm text-muted-foreground">{description}</div>}
            <div className="mt-6">{children}</div>
          </div>
          {footer && <div className="mt-4 text-center text-sm text-muted-foreground">{footer}</div>}
        </div>
      </div>
      <p className="pb-6 text-center text-xs text-muted-foreground">Internal tool · Joyno Media</p>
    </div>
  )
}

/** Only allow same-origin relative paths as post-login destinations. */
export function safeNext(value: string | null | undefined, fallback = '/'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback
  return value
}
