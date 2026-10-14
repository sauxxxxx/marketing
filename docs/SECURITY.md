# Security model

The browser is never trusted. Every authorisation decision is made in PostgreSQL, through Row Level Security (RLS), column-level grants, triggers and `SECURITY DEFINER` functions, or in an Edge Function that holds the service-role key. UI permission checks (`src/lib/permissions.ts`) only decide what to show.

## Roles

| Capability | Administrator | Editor | Viewer |
|---|:-:|:-:|:-:|
| View content (calendar, board, library, summaries) | ✓ all | only posts assigned to them | ✓ all |
| View monthly plans | ✓ all | their brands | ✓ all |
| Export PDF / print view | ✓ | ✓ | ✓ |
| Create content, attach files | ✓ | ✓ in their brands, owned by them | |
| Edit content | ✓ | ✓ posts assigned to them | |
| Change status, reschedule | ✓ | ✓ posts assigned to them | |
| Assign or reassign content owners | ✓ | | |
| Archive / restore content | ✓ | ✓ posts assigned to them | |
| Delete content permanently | ✓ | | |
| Create, rename, archive plans | ✓ | ✓ their brands | |
| Assign editors to brands | ✓ | | |
| Duplicate plans | ✓ | ✓ if the workspace allows | |
| Manage brands, formats, pillars, key dates | ✓ | | |
| Workspace settings and editing rules | ✓ | | |
| Invite, change roles, deactivate members | ✓ | | |
| Read the workspace audit history | ✓ | | |

## Where each rule is enforced

| Concern | Mechanism | File |
|---|---|---|
| Workspace isolation | RLS on every table: `is_workspace_member(workspace_id)` | `20261013000300_rls_policies.sql` |
| Role checks | `has_workspace_role`, `can_edit_content`, `can_duplicate_plans` (SECURITY DEFINER, `search_path=''`) | `20261013000200_functions_triggers.sql` |
| No self-promotion | `workspace_members` has **no** insert/update/delete grant for API roles; changes only go through `update_member_role` / `set_member_status` / `accept_invitation`, which check admin rights and protect the last administrator | `20261013000400_rpc_functions.sql` |
| Profiles can't carry roles | Only `full_name` and `avatar_url` are updatable; email is synced from `auth.users` | RLS + column grants |
| Forged authorship or approval | `created_by`, `approved_by`, `approved_at`, `updated_by`, `deleted_by`, `search_text` aren't grantable; triggers stamp them | column grants + `content_items_validate` |
| Cross-workspace references | Composite foreign keys `(workspace_id, id)` for brand, format, pillar, plan and assignee; triggers require active brands, formats and pillars and active admin/editor assignees | `20261013000100_core_schema.sql` |
| Status workflow | Transition trigger (works even if the UI is bypassed) | `is_status_transition_allowed` |
| Ownership | Every post has an owner: new posts default to their creator; only administrators change it, never to empty; an editor owner must be a brand editor of the post's brand | `content_items_assignment_guard` (migrations 800, 900) |
| Owner-based visibility | Editors read/write only posts assigned to them; activity, attachments and stored files follow the post; editors see plans only for their brands | `can_view_content`, `can_edit_content`, `can_read_storage_path`, `can_access_brand` (migration 900) |
| Private files | Private bucket `workspace-files`; storage RLS checks the workspace folder and content edit rights; MIME allow-list (no SVG) and 50 MB limit at bucket level; downloads via 5-minute signed URLs | `20261013000500_storage.sql` |
| Invitation tokens | 244-bit random token, only SHA-256 stored, never selectable (column grant excludes `token_hash`), 7-day expiry, single use, bound to the invited email, which must be confirmed. Re-inviting revokes the older link. 30 invites per admin per hour | `create_invitation`, `accept_invitation` |
| First administrator | Edge Function requires the `BOOTSTRAP_TOKEN` secret (fails closed if unset); singleton row lock serialises attempts; provisioning is one transaction; refuses once any admin exists; the request's role field is ignored | `supabase/functions/bootstrap`, `bootstrap_*` functions |
| Function exposure | All `EXECUTE` grants revoked, then re-granted per function. `anon` can execute only `get_setup_status` (tested) | `20261013000600_function_privileges.sql` |
| Public sign-up | Disabled (`enable_signup = false`). Even if re-enabled, a new account has no membership and sees "No workspace access" | `supabase/config.toml` |
| Secrets | Service-role key and `BOOTSTRAP_TOKEN` exist only in Edge Function secrets. The frontend only sees the public URL and anon key | `.env.example` |
| Error leakage | `friendlyError` passes through only messages deliberately raised by our functions; SQL, constraint and policy text is replaced | `src/lib/errors.ts` |
| Open redirects | `?next=` accepts same-origin relative paths only | `safeNext` |
| Session storage | Supabase session in localStorage ("Keep me signed in") or sessionStorage. Roles and workspace access are always re-read from the database | `src/lib/supabase.ts` |
| Logout | `signOut({ scope: 'local' })` plus `queryClient.clear()`; guards redirect immediately | `AuthProvider` |
| Deactivation | Deactivated membership fails every RLS check immediately (JWTs stay valid up to an hour, but no data is returned) | `set_member_status` |
| Clickjacking etc. | `X-Frame-Options: DENY`, `nosniff`, referrer policy, `noindex` | `vercel.json` |

## Verified by automated tests

`npm run test:db` applies every migration to a real PostgreSQL engine (PGlite) with a Supabase-compatible `auth`/`storage` shim. It then runs, as each role:

- viewers can't insert, update, delete or change status;
- editors can't change roles, write memberships, invite, delete permanently or forge stamps;
- the edit-own-content rule is enforced when enabled;
- non-members and anon see nothing, and cross-workspace IDs can't be read, written or referenced;
- administrators can't remove the last administrator or administer another workspace;
- deactivated members lose access but keep their content;
- invitation tokens are hashed, single use, email-bound, expire, can be revoked and are rate limited;
- bootstrap is unavailable to API roles, enforces its lease, validates input, succeeds once and then always fails;
- storage uploads, reads and deletes follow workspace and edit rights; path tricks and foreign workspaces are rejected;
- duplication rolls back completely on failure;
- every `SECURITY DEFINER` function pins `search_path`.

## Known limitations and recommendations

1. **Concurrency was tested sequentially.** PGlite is single-connection, so the bootstrap race is verified through the lock/lease logic, not true parallel requests. The row lock (`select … for update` on the `system_state` singleton) is standard PostgreSQL behaviour.
2. **Brute force on `BOOTSTRAP_TOKEN`.** Use at least 32 random bytes. After setup, delete the secret (`supabase secrets unset BOOTSTRAP_TOKEN`) or the function; it then returns 503. The database refuses a second bootstrap regardless.
3. **Invitation email oracle.** `create_invitation` tells the calling administrator whether an auth account already exists for an email (needed to choose the email type). Only workspace administrators can call it.
4. **Viewers can read internal notes and activity.** This matches "view content details". If notes must be hidden from viewers, move them to a separate table with its own policy.
5. **Orphaned storage objects.** Permanent deletion from the UI removes files first. Rows deleted directly in SQL leave files behind; clean them up with a periodic job if needed.
6. **JWT lifetime.** Access tokens live up to an hour (`jwt_expiry`), but RLS re-checks membership on every request, so deactivation takes effect immediately for data access.
7. **Hosted settings aren't in code.** Disabling sign-up, redirect URLs, SMTP, leaked-password protection and MFA must be set in the Supabase dashboard (see README).
8. **No public share links.** The read-only `/print` view requires sign-in and membership. Token-based public sharing was deliberately not built.
