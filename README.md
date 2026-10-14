# Joyno Media Content Studio

Internal web app where the Joyno Media team plans, produces, reviews and tracks social media content. It replaces the monthly Canva calendar. The calendar, production board, monthly summaries and PDF exports all read the same database records.

- **Frontend:** React 19, Vite 7, TypeScript, Tailwind CSS 4, shadcn/ui (Radix), Lucide, TanStack Query, React Hook Form + Zod, dnd-kit, @react-pdf/renderer
- **Backend:** Supabase (PostgreSQL with RLS, Auth, private Storage, Edge Functions on Deno)
- **Hosting:** Vercel (static SPA) + Supabase

Further reading:

- [docs/SECURITY.md](docs/SECURITY.md): roles, RLS and how each rule is enforced
- [docs/DATA-RULES.md](docs/DATA-RULES.md): status workflow, scheduling, counting rules, duplication

---

## Contents

1. [Features](#features)
2. [Project layout](#project-layout)
3. [Local development](#local-development)
4. [Environment variables](#environment-variables)
5. [Supabase project setup (hosted)](#supabase-project-setup-hosted)
6. [First administrator](#first-administrator)
7. [Email: invitations and password reset](#email-invitations-and-password-reset)
8. [Storage](#storage)
9. [Development seed data](#development-seed-data)
10. [Testing](#testing)
11. [Deploying to Vercel](#deploying-to-vercel)
12. [Backup and recovery](#backup-and-recovery)
13. [Troubleshooting](#troubleshooting)

---

## Features

| Area | What it does |
|---|---|
| Setup and auth | One-time first-admin setup (token-protected), email/password login with "keep me signed in", forgot/reset password, logout that clears cached data |
| Team | Admins invite Editors/Viewers by email, change roles (including Administrator), deactivate or reactivate members, revoke or resend invitations. Falls back to a copyable link if email delivery fails |
| Ownership | Every post has an owner (defaults to its creator; only admins reassign). Editors are assigned to brands and see and edit only their own posts; admins and viewers see everything |
| Content calendar | Month, week, two-week and agenda views from the same records; fixed-height month cells with two previews, post counts and a scrollable day drawer; agenda on desktop and phones with optional brand grouping; drag-and-drop rescheduling with rollback on failure; brand/format/pillar/status/assignee filters stored in the URL; weekends and key dates highlighted; automatic summary sidebar |
| Content editor | Basics, copywriting, strategy, production and publishing fields; unscheduled ideas; private file uploads and external links; activity history; unsaved-change warnings; archive/restore; reuse as a new item |
| Production board | Kanban with workflow-validated drag-and-drop, optional Needs Revision/Cancelled columns, date-range filters and overdue flags (icon plus text) |
| Overview | Live counts linked to filtered views: next 7 days, in production, awaiting review, needs revision, approved, overdue. Plus upcoming, overdue and recently updated lists |
| Library | Search across titles, captions, hashtags, purpose and CTA; filters, sorting and pagination; ideas vs. in-plan; archived items; overdue-only |
| Monthly plans | One per brand per month; create, rename, archive; plan page with summary and ideas; duplication with a server-computed preview |
| Exports | Calendar overview PDF (A4 landscape, single page, legend, summary, key dates) and detailed plan PDF (A4 portrait, paginated captions, optional internal notes); authenticated printable view |
| Settings | Account (name, password); workspace (name, logo, timezone, default view, default platforms, editing rules); brands; formats and pillars (colours, order, active); key dates; audit history |

## Project layout

```
src/
  app/                 router and route guards
  components/ui/       shadcn/ui primitives
  components/common/   page header, states (loading/empty/error/denied), dialogs, fields
  components/content/  cards, badges, editor panel, assets, activity, filters, summary
  components/layout/   app shell, sidebar, header, quick search
  features/            auth, overview, calendar, board, library, plans, team, settings, export
  hooks/               TanStack Query data hooks (the only way the UI reads or writes data)
  lib/                 supabase client, dates/timezones, status policy, summary rules,
                       filters, permissions, validation, error mapping
  types/database.ts    typed schema for supabase-js
supabase/
  migrations/          schema, triggers, RLS, RPCs, storage, privileges, search
  functions/           bootstrap + invite-member Edge Functions (handlers are unit-tested)
  templates/           branded auth email templates
  seed.sql             development/demo data (no users, no passwords)
  config.toml          local Supabase CLI config
scripts/seed-dev-users.mjs   creates demo users with a password you supply
tests/db/              migration + RLS tests on real PostgreSQL (PGlite)
tests/unit/            domain logic, components, Edge Function handlers, PDF output
```

## Local development

**Prerequisites:** Node.js ≥ 20.19, npm, and Docker Desktop (for the local Supabase stack). The Supabase CLI runs through `npx`.

```bash
npm install

# 1. Start local Supabase (Postgres, Auth, Storage, Edge runtime, Mailpit)
npx supabase start
npx supabase db reset            # applies all migrations, then supabase/seed.sql

# 2. Frontend env: use the API URL and anon key printed by `npx supabase status`
cp .env.example .env.local
#   VITE_SUPABASE_URL=http://127.0.0.1:54321
#   VITE_SUPABASE_ANON_KEY=<anon key>
#   VITE_APP_URL=http://localhost:5173

# 3. Edge Function secrets
cp supabase/functions/.env.example supabase/functions/.env
#   BOOTSTRAP_TOKEN=<long random string>, APP_URL=http://localhost:5173,
#   ALLOWED_ORIGINS=http://localhost:5173
npx supabase functions serve --env-file supabase/functions/.env

# 4. Run the app
npm run dev                      # http://localhost:5173
```

Next, either open <http://localhost:5173/setup> and create the first administrator with your `BOOTSTRAP_TOKEN`, or create demo users (see [Development seed data](#development-seed-data)). Local emails (invites, resets) appear in Mailpit; the URL is shown by `npx supabase status`.

## Environment variables

**Frontend** (Vercel / `.env.local`). These are public by design; never put secrets here.

| Name | Example | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://abcd.supabase.co` | Project API URL |
| `VITE_SUPABASE_ANON_KEY` | `eyJ…` | Public anon key (RLS protects data) |
| `VITE_APP_URL` | `https://studio.joynomedia.ph` | Base URL for password-reset redirects |

**Edge Function secrets** (`supabase secrets set …`). Server-only.

| Name | Purpose |
|---|---|
| `BOOTSTRAP_TOKEN` | One-time setup token for `/setup`. Required for the setup flow (fails closed). Remove after setup |
| `APP_URL` | Public app URL used in invitation links |
| `ALLOWED_ORIGINS` | Comma-separated browser origins allowed to call the functions |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Injected by Supabase automatically; never set these in the frontend |

Keep **separate Supabase projects** for development/staging and production, each with its own keys, secrets and redirect URLs. `.env*` files are git-ignored except the examples.

## Supabase project setup (hosted)

1. **Create a project** at <https://supabase.com/dashboard> (region close to Manila, e.g. Singapore).
2. **Link and push the schema:**
   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push          # applies supabase/migrations in order
   ```
   Don't run `seed.sql` against production.
3. **Authentication → Sign In / Providers → Email:**
   - turn **off** "Allow new users to sign up" (accounts come only from setup and invitations);
   - keep "Confirm email" on;
   - set minimum password length to 12 and require lower, upper and digits;
   - enable leaked-password protection (Pro plan) and consider MFA for administrators.
4. **Authentication → URL Configuration:**
   - **Site URL:** `https://studio.joynomedia.ph`
   - **Redirect URLs** (the wildcard is needed so links can carry `?token=`):
     - `https://studio.joynomedia.ph/**`
     - `http://localhost:5173/**` (only on the development project)
     - Vercel preview URLs (e.g. `https://*-joyno.vercel.app/**`) only on non-production projects
5. **Email templates and SMTP:** see [Email](#email-invitations-and-password-reset).
6. **Edge Functions:**
   ```bash
   npx supabase secrets set --env-file supabase/functions/.env   # BOOTSTRAP_TOKEN, APP_URL, ALLOWED_ORIGINS
   npx supabase functions deploy bootstrap --no-verify-jwt       # caller has no account yet; token-gated
   npx supabase functions deploy invite-member                   # JWT required
   ```
7. **Check storage:** the migration creates the private bucket `workspace-files`. In Storage, confirm it's **not public**.

## First administrator

There is no public registration. Choose one option.

**A. Setup page (recommended)**

1. Generate a token, e.g. `openssl rand -base64 32`, and store it as the `BOOTSTRAP_TOKEN` secret.
2. Open `https://<app>/setup`. It appears only while no administrator exists.
3. Enter your name, email, workspace name (default "Joyno Media"), a password and the setup token.
4. The `bootstrap` function checks the token, takes a database lock, creates the confirmed auth user and provisions the workspace, admin membership and default formats/pillars in one transaction. If any step fails, the user is deleted and the lock released.
5. Afterwards, `npx supabase secrets unset BOOTSTRAP_TOKEN` (the function then returns 503). The database refuses any further bootstrap regardless.

**B. Manual (SQL editor)**

1. Authentication → Users → *Add user*, with "Auto confirm" ticked.
2. In the SQL editor (runs as `postgres`):
   ```sql
   select public.bootstrap_existing_user('you@joynomedia.ph', 'Your Name', 'Joyno Media');
   ```
   This works only while no administrator exists. The function isn't executable by API roles.

## Email: invitations and password reset

- **Invitations** (`invite-member` function): admins choose Editor or Viewer. The database creates a single-use, 7-day, hashed token and the function sends:
  - new people: Supabase's **Invite** email, which leads to `/accept-invite?token=…&setup=1` where they choose a name and password;
  - existing accounts: a **Magic link** email, which leads to `/accept-invite?token=…`.
  If sending fails (Supabase's built-in mailer is limited to a few emails per hour), the admin sees a one-time link to share directly. It only works for the invited email.
- **Password reset:** `/forgot-password` always shows the same confirmation. The **Reset password** email returns to `/reset-password`, which requires the recovery session from that link.
- **Templates:** copy the HTML in `supabase/templates/` into Authentication → Email Templates (Invite user, Magic link, Reset password). Each uses `{{ .ConfirmationURL }}`. Suggested subjects are in `supabase/config.toml`.
- **SMTP:** for production, configure custom SMTP (Authentication → SMTP Settings), e.g. Resend, Postmark or SES, with a verified sender like `studio@joynomedia.ph`.

## Storage

| Path | Who can upload/delete | Who can read |
|---|---|---|
| `{workspace}/content/{content}/{uuid}-{file}` | Admins, and the editor who owns that content | Admins, viewers, and the editor who owns that content |
| `{workspace}/branding/{uuid}-{file}` | Administrators | Workspace members |

The bucket is private, limited to 50 MB, and allows images, video, PDF, Office files, PSD/AI and ZIP (no SVG). Files open through 5-minute signed URLs.

## Development seed data

`supabase/seed.sql` (run automatically by `npx supabase db reset`) creates a separate **"Joyno Media (Demo)"** workspace flagged `is_demo`. It contains three brands, formats and pillars, a plan for the current month, content in every status and fixed-date PH holidays for this year and next. It's idempotent and creates no users.

To sign in to the demo workspace locally:

```bash
SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_SERVICE_ROLE_KEY=<service_role key from `npx supabase status`> \
DEV_SEED_PASSWORD='Choose-A-Strong-Passw0rd' \
npm run seed:users
```

This creates `admin@`, `editor@` and `viewer@demo.joyno.local`. The script has no default password and refuses non-local URLs unless `ALLOW_REMOTE_SEED=1`. Demo records show a "Demo" badge, and the app never depends on them.

> The demo admin counts as an administrator, so `/setup` closes once these users exist. To test the setup flow, run `npx supabase db reset` without running `seed:users`.

## Testing

```bash
npm run typecheck        # TypeScript (app, tests, Vite config)
npm test                 # all Vitest projects
npm run test:db          # migrations + RLS/security tests on real PostgreSQL (PGlite)
npm run test:unit        # domain logic, React components, Edge Function handlers, PDF output
npm run check:functions  # deno type-check of the Edge Functions
npm run build            # production build
npm run verify           # all of the above
```

What's covered:

- **Database (72 tests):** migrations apply cleanly; RLS on every table; anon has no table access; bootstrap; per-role permissions; workspace isolation; status transitions (and parity with the UI table); approval vs. publication; activity logging; plan auto-linking; invitations; duplication including rollback; storage policies; seed idempotency.
- **Unit and component (59 tests):** counting rules; transition policy; filters and URL safety; timezone handling; optimistic update and rollback; error sanitising; validation; login, redirect, logout and cache clearing; password reset; calendar placement across views; drag persistence and rollback; Edge Function handlers (token gate, validation, cleanup, CORS, email fallback); generated PDFs (single-page calendar, brand/month metadata, paginated captions).

Not covered automatically: end-to-end tests against a live Supabase project (Auth emails, Storage HTTP, deployed functions). Before go-live, run through the [go-live checklist](#go-live-checklist).

## Deploying to Vercel

1. Import the repository in Vercel. The framework preset is Vite; `vercel.json` sets the build, SPA rewrites and security headers.
2. Add `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_APP_URL` for **Production**, and the development project's values for **Preview**.
3. Deploy, then add the production domain to Supabase redirect URLs and to `ALLOWED_ORIGINS` / `APP_URL`, and redeploy the functions if you change secrets.

### Go-live checklist

- [ ] Sign-up disabled; Site URL and redirect URLs set; custom SMTP configured and templates pasted
- [ ] `npx supabase db push` succeeded; bucket `workspace-files` is private
- [ ] Functions deployed (`bootstrap` with `--no-verify-jwt`); secrets set
- [ ] First admin created; `BOOTSTRAP_TOKEN` removed
- [ ] Invite an Editor and a Viewer; accept from a private window; confirm the Viewer can't edit and the Editor can't open Team
- [ ] Password reset works end to end
- [ ] Upload a file, open it, and confirm a member of another workspace (or signed-out user) can't
- [ ] Export both PDFs for a real month

## Backup and recovery

- **Database:** Supabase takes daily backups (Pro: 7 days; enable Point-in-Time Recovery for finer restores). Also take your own logical backups:
  ```bash
  npx supabase db dump --linked -f backup-schema.sql
  npx supabase db dump --linked --data-only -f backup-data.sql
  ```
  Store them encrypted, off-platform, and test restores into a scratch project.
- **Storage:** files aren't in database dumps. Periodically sync the `workspace-files` bucket (S3-compatible API or `supabase storage` CLI) to separate storage.
- **Accidental deletes:** content is archived by default and can be restored from the Library. Plans are archived, not deleted. Formats and pillars in use can't be deleted.
- **Secrets:** keep `BOOTSTRAP_TOKEN` (if still set) and the service-role key in a password manager. Rotate keys from Project Settings → API if exposed.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| "Configuration required" page | `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` missing; restart `npm run dev` after editing `.env.local` |
| Setup says "Initial setup is disabled" | `BOOTSTRAP_TOKEN` secret not set (or under 16 characters) for the `bootstrap` function |
| Setup or invite fails with a network error | Function not deployed or not served locally; `ALLOWED_ORIGINS` doesn't include the app's origin |
| "No workspace access" after login | The account has no active membership: accept an invitation, or an admin must reactivate it |
| Invite or reset link lands on login with "link not valid" | Redirect URL not allow-listed (needs `/**`), link expired or already used, or opened in a different browser |
| Invitation emails don't arrive | Built-in mailer rate limit. Configure custom SMTP, or use the shareable link the Team page shows |
| "Status cannot change from X to Y" | Expected: see the transition policy in docs/DATA-RULES.md |
| An editor can't see or edit a post | Editors only see posts assigned to them. An admin can reassign it to them (they must be an editor of that brand) |
| An editor can't create content / "You aren't assigned to this brand" | Add them to the brand in Settings → Brands → Editors |
| Can't delete a format or pillar | It's used by content. Deactivate it instead |
| Upload rejected | File type not allowed (e.g. SVG) or larger than 50 MB |
| PDF shows missing characters | The built-in PDF font can't render emoji; they're removed in exports |
