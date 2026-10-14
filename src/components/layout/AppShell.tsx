import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  CalendarDays,
  ChevronsUpDown,
  KanbanSquare,
  LayoutDashboard,
  Library,
  LogOut,
  Menu,
  NotebookTabs,
  Plus,
  Search,
  Settings,
  UserRound,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { LogoMark } from '@/components/common/Logo'
import { PersonAvatar } from '@/components/content/badges'
import { useContentPanel } from '@/components/content/ContentPanel'
import { useAuth } from '@/features/auth/AuthProvider'
import { useActiveWorkspace } from '@/features/workspace/WorkspaceProvider'
import { can, ROLE_LABEL, type Permission } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { CommandSearch } from './CommandSearch'

interface NavItem {
  to: string
  label: string
  icon: typeof CalendarDays
  permission?: Permission
}

const NAV: NavItem[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/calendar', label: 'Content Calendar', icon: CalendarDays },
  { to: '/board', label: 'Production Board', icon: KanbanSquare },
  { to: '/library', label: 'Content Library', icon: Library },
  { to: '/plans', label: 'Monthly Plans', icon: NotebookTabs },
  { to: '/team', label: 'Team', icon: Users, permission: 'team.manage' },
  { to: '/settings', label: 'Settings', icon: Settings },
]

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { role } = useActiveWorkspace()
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5 px-2">
      {NAV.filter((item) => !item.permission || can(role, item.permission)).map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              isActive && 'bg-sidebar-accent text-sidebar-accent-foreground',
            )
          }
        >
          <item.icon className="size-4 shrink-0" aria-hidden />
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
}

function WorkspaceHeader() {
  const { workspace, memberships, switchWorkspace, role } = useActiveWorkspace()
  const others = memberships.filter((m) => m.status === 'active' && m.workspace)
  const label = (
    <div className="flex min-w-0 items-center gap-2.5">
      <LogoMark />
      <div className="min-w-0 text-left leading-tight">
        <div className="truncate text-sm font-semibold">{workspace.name}</div>
        <div className="truncate text-[11px] text-muted-foreground">Content Studio · {ROLE_LABEL[role]}</div>
      </div>
    </div>
  )
  if (others.length <= 1) return <div className="px-3 py-3">{label}</div>
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="m-1.5 flex items-center justify-between gap-2 rounded-md p-1.5 hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring">
        {label}
        <ChevronsUpDown className="size-4 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel>Switch workspace</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={workspace.id} onValueChange={switchWorkspace}>
          {others.map((m) => (
            <DropdownMenuRadioItem key={m.workspace_id} value={m.workspace_id}>
              {m.workspace!.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function AccountMenu() {
  const { signOut, user } = useAuth()
  const { profile, role } = useActiveWorkspace()
  const name = profile?.full_name || user?.email || 'Account'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2 px-1.5" aria-label="Account menu">
          <PersonAvatar name={name} className="size-7 text-[11px]" />
          <span className="hidden max-w-32 truncate text-sm lg:inline">{name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <div className="truncate text-sm font-medium">{name}</div>
          <div className="truncate text-xs text-muted-foreground">{user?.email}</div>
          <div className="mt-1 text-xs text-muted-foreground">{ROLE_LABEL[role]}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <NavLink to="/settings?tab=account">
            <UserRound /> Account settings
          </NavLink>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => signOut()}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const { role, workspace } = useActiveWorkspace()
  const { createContent } = useContentPanel()
  const location = useLocation()

  useEffect(() => setMobileOpen(false), [location.pathname])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-card focus:px-3 focus:py-2">
        Skip to content
      </a>
      <aside className="no-print hidden w-[232px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <WorkspaceHeader />
        <div className="mt-1 flex-1 overflow-y-auto">
          <NavLinks />
        </div>
        {workspace.is_demo && (
          <div className="m-3 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900">Demo workspace — sample data only.</div>
        )}
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[260px] gap-0 bg-sidebar p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">Main navigation</SheetDescription>
          <WorkspaceHeader />
          <NavLinks onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print flex h-13 shrink-0 items-center gap-2 border-b bg-card px-3 md:px-4">
          <Button variant="ghost" size="icon-sm" className="md:hidden" aria-label="Open navigation" onClick={() => setMobileOpen(true)}>
            <Menu />
          </Button>
          <span className="truncate text-sm font-semibold md:hidden">{workspace.name}</span>
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="ml-auto flex h-8 w-full max-w-72 items-center gap-2 rounded-md border bg-background px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent md:ml-0"
            aria-label="Search content"
          >
            <Search className="size-4" aria-hidden />
            <span className="hidden truncate sm:inline">Search content…</span>
            <kbd className="ml-auto hidden rounded border bg-card px-1 text-[10px] font-medium sm:inline">Ctrl K</kbd>
          </button>
          <div className="ml-auto flex items-center gap-1.5">
            {can(role, 'content.create') && (
              <Button size="sm" onClick={() => createContent()}>
                <Plus /> <span className="hidden sm:inline">New content</span>
              </Button>
            )}
            <AccountMenu />
          </div>
        </header>
        <main id="main" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <Outlet />
        </main>
      </div>
      <CommandSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  )
}
