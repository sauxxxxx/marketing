import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { createMockSupabase, fakeSession } from './mockSupabase'

const mock = vi.hoisted(() => ({ current: null as ReturnType<typeof createMockSupabase> | null }))

vi.mock('@/lib/supabase', () => ({
  get supabase() {
    return mock.current!.client
  },
  requireSupabase: () => mock.current!.client,
  getRememberSession: () => true,
  setRememberSession: vi.fn(),
  appUrl: 'https://studio.example.com',
}))

import { AuthProvider, useAuth } from '@/features/auth/AuthProvider'
import { LoginPage } from '@/features/auth/LoginPage'
import { ResetPasswordPage } from '@/features/auth/ResetPasswordPage'
import { ForgotPasswordPage } from '@/features/auth/ForgotPasswordPage'
import { RequireAuth } from '@/app/guards'

function Where() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname + location.search}</div>
}

function renderApp(entry: string, routes: ReactNode, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const utils = render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>{routes}</Routes>
          <Where />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
  return { ...utils, client }
}

beforeEach(() => {
  mock.current = createMockSupabase()
})

describe('login', () => {
  const routes = (
    <>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/setup" element={<div>Setup page</div>} />
      <Route path="/calendar" element={<div>Calendar page</div>} />
    </>
  )

  it('validates fields before calling Supabase', async () => {
    renderApp('/login', routes)
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Enter your email address.')).toBeInTheDocument()
    expect(screen.getByText('Enter your password.')).toBeInTheDocument()
    expect(mock.current!.client.auth.signInWithPassword).not.toHaveBeenCalled()
  })

  it('shows a safe message for invalid credentials', async () => {
    mock.current!.client.auth.signInWithPassword.mockResolvedValueOnce({
      data: {},
      error: { name: 'AuthApiError', code: 'invalid_credentials', message: 'Invalid login credentials', status: 400 },
    })
    renderApp('/login', routes)
    await userEvent.type(await screen.findByLabelText('Email'), 'ana@joyno.example')
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.')
  })

  it('signs in and returns to the requested page', async () => {
    mock.current!.client.auth.signInWithPassword.mockImplementationOnce(async () => {
      mock.current!.emit('SIGNED_IN', fakeSession)
      return { data: {}, error: null }
    })
    renderApp('/login?next=%2Fcalendar', routes)
    await userEvent.type(await screen.findByLabelText('Email'), 'ana@joyno.example')
    await userEvent.type(screen.getByLabelText('Password'), 'Correct-Password-1')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Calendar page')).toBeInTheDocument()
    expect(mock.current!.client.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'ana@joyno.example', password: 'Correct-Password-1' })
  })

  it('ignores external redirect targets', async () => {
    mock.current!.setSession(fakeSession)
    renderApp('/login?next=https%3A%2F%2Fevil.example', <><Route path="/login" element={<LoginPage />} /><Route path="/" element={<div>Home</div>} /></>)
    expect(await screen.findByText('Home')).toBeInTheDocument()
  })

  it('sends first-time installations to the setup page', async () => {
    mock.current!.client.rpc.mockResolvedValue({ data: { initialized: false }, error: null })
    renderApp('/login', routes)
    expect(await screen.findByText('Setup page')).toBeInTheDocument()
  })
})

describe('route protection and logout', () => {
  it('redirects unauthenticated visitors to sign in, preserving the destination', async () => {
    renderApp(
      '/board?status=approved',
      <>
        <Route element={<RequireAuth />}>
          <Route path="/board" element={<div>Board</div>} />
        </Route>
        <Route path="/login" element={<div>Login page</div>} />
      </>,
    )
    expect(await screen.findByText('Login page')).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/login?next=%2Fboard%3Fstatus%3Dapproved')
  })

  it('logout ends the session, clears cached private data and blocks protected pages', async () => {
    mock.current!.setSession(fakeSession)
    let signOut: () => Promise<void> = async () => undefined
    function Capture() {
      signOut = useAuth().signOut
      return <div>Private content</div>
    }
    const { client } = renderApp(
      '/private',
      <>
        <Route element={<RequireAuth />}>
          <Route path="/private" element={<Capture />} />
        </Route>
        <Route path="/login" element={<div>Login page</div>} />
      </>,
    )
    expect(await screen.findByText('Private content')).toBeInTheDocument()
    client.setQueryData(['ws', 'w1', 'content', 'range'], [{ id: 'secret' }])

    await act(() => signOut())

    expect(mock.current!.client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(client.getQueryData(['ws', 'w1', 'content', 'range'])).toBeUndefined()
    expect(await screen.findByText('Login page')).toBeInTheDocument()
    expect(screen.queryByText('Private content')).not.toBeInTheDocument()
  })
})

describe('password recovery', () => {
  it('never reveals whether an account exists', async () => {
    renderApp('/forgot', <Route path="/forgot" element={<ForgotPasswordPage />} />)
    await userEvent.type(await screen.findByLabelText('Email'), 'nobody@joyno.example')
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(await screen.findByText(/If an account exists for/)).toBeInTheDocument()
    expect(mock.current!.client.auth.resetPasswordForEmail).toHaveBeenCalledWith('nobody@joyno.example', {
      redirectTo: 'https://studio.example.com/reset-password',
    })
  })

  it('rejects the reset page without a recovery session', async () => {
    renderApp('/reset-password', <Route path="/reset-password" element={<ResetPasswordPage />} />)
    expect(await screen.findByText('Link not valid')).toBeInTheDocument()
  })

  it('updates the password with a recovery session and signs out', async () => {
    mock.current!.setSession(fakeSession)
    renderApp('/reset-password', <Route path="/reset-password" element={<ResetPasswordPage />} />)
    await userEvent.type(await screen.findByLabelText('New password'), 'BrandNewPassw0rd')
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'BrandNewPassw0rd')
    await userEvent.click(screen.getByRole('button', { name: 'Update password' }))
    expect(await screen.findByText('Password updated')).toBeInTheDocument()
    expect(mock.current!.client.auth.updateUser).toHaveBeenCalledWith({ password: 'BrandNewPassw0rd' })
    await waitFor(() => expect(mock.current!.client.auth.signOut).toHaveBeenCalled())
  })

  it('enforces the password policy on reset', async () => {
    mock.current!.setSession(fakeSession)
    renderApp('/reset-password', <Route path="/reset-password" element={<ResetPasswordPage />} />)
    await userEvent.type(await screen.findByLabelText('New password'), 'weak')
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'different')
    await userEvent.click(screen.getByRole('button', { name: 'Update password' }))
    expect(await screen.findByText('Use at least 12 characters.')).toBeInTheDocument()
    expect(screen.getByText('Passwords don’t match.')).toBeInTheDocument()
    expect(mock.current!.client.auth.updateUser).not.toHaveBeenCalled()
  })
})
