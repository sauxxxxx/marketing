# Workflow and counting rules

These rules are enforced in the database and mirrored in the UI. Where both exist, tests check that they agree.

## Content statuses

| Status | Meaning |
|---|---|
| Planned | On the calendar; production hasn't started |
| In Production | Being written or designed |
| For Review | Ready for someone to check |
| Needs Revision | Sent back with changes requested |
| Approved | Signed off; **not necessarily live** |
| Published | Live; `published_at` records when |
| Cancelled | Dropped; kept for history, never counted |

### Transition policy

Enforced by the `content_items_validate` trigger (`public.is_status_transition_allowed`) and mirrored in `src/lib/status.ts`. The test `tests/db/content-workflow.test.ts` compares both tables cell by cell for every role.

```
planned        → in_production, cancelled
in_production  → for_review, planned, cancelled
for_review     → approved, needs_revision, in_production, cancelled
needs_revision → in_production, for_review, cancelled
approved       → published, needs_revision, cancelled
published      → approved      (reopen — administrators only)
cancelled      → planned       (reopen — administrators and editors)
```

- Viewers can never change status.
- New items may be created in any status (for backfilling history). Approval and publication stamps are set automatically.
- **Approval is separate from publication.** Moving to Approved records `approved_by` and `approved_at` from the signed-in user; the client can't write these columns. Sending an item back (Needs Revision, In Production, Planned, Cancelled) clears the approval. Publishing keeps it.
- Moving to Published fills `published_at` with the current time if it's empty.
- Reopening shows a confirmation in the UI and is logged as `reopened` in the activity history.

## Ownership and brands

- Every post has an **owner** (`assigned_to`). New posts are owned by whoever creates them; administrators can hand a post to themselves, another administrator or an editor of that post's brand, but never leave it unowned.
- Editors are assigned to brands (Settings → Brands). They create content only in those brands and **see and edit only the posts they own**. Administrators and viewers see everything.
- Existing posts without an owner were given one when migration 900 ran: the creator if still an active admin or editor, otherwise the longest-standing administrator. Editors who already worked on a brand were added as its brand editors.

## Scheduling and timezone

- `scheduled_date` and `scheduled_time` are a **local date and optional local time in the workspace timezone** (default Asia/Manila). A post scheduled for the 5th shows on the 5th for every viewer, whatever their device timezone.
- "Today" and overdue checks use the workspace timezone (`todayInTimeZone`).
- `published_at` is a real timestamp. The editor converts between it and workspace wall-clock time.
- Items without a date are **unscheduled ideas**. They appear in the Content Library ("Ideas") and can be parked inside a monthly plan.

## Monthly plans

- One plan per brand per calendar month (unique constraint `monthly_plans_one_per_brand_month`; drop it later to allow several).
- A plan's brand and month can't change after creation; duplicate the plan instead.
- Scheduled content is linked to the plan for its brand and month **automatically**. Creating a plan attaches content already scheduled for that brand and month, and rescheduling an item into another month moves it to that month's plan (or unlinks it).
- Plans are archived, never deleted. Archiving doesn't hide their content from the calendar.

## Monthly summary counting rules

Implemented in `src/lib/summary.ts` and tested in `tests/unit/domain.test.ts`. The same function drives the calendar sidebar, plan pages and PDF exports.

1. **Summary set**: non-archived items whose `scheduled_date` falls inside the period and that pass the active filters.
2. **Planned posts** = items in the set whose status isn't Cancelled.
3. **Published** = items in the set with status Published.
4. **Approved** = status Approved (approved but not yet published).
5. **Unscheduled ideas** are never counted as scheduled. They're reported separately.
6. **Format and pillar breakdowns** use exactly the planned-posts set, so they always add up to the planned total. Items without a pillar appear as "No pillar".
7. **Status breakdown** covers the whole set, including Cancelled.
8. **Overdue**, for any status except Published or Cancelled, means either:
   - the scheduled date is before today (publication overdue), or
   - the production deadline is before today while status is Planned, In Production, For Review or Needs Revision (production overdue).

## Plan duplication

`public.duplicate_monthly_plan` runs as a single transaction under the caller's RLS. A dry run (`p_dry_run = true`) powers the preview, so the preview and the commit share one code path.

- The original plan and its items are never modified, and new items get new IDs.
- Copies start as **Planned**, with approval, publication time and live URL cleared, and no copied activity history: only a `duplicated` event pointing at the source item.
- **Full content** copies captions, hashtags, CTA, purpose, audience, brief and references. When an **administrator** duplicates, owners are kept if they're still active and allowed on the target brand; otherwise (and always for editors) the person duplicating owns the copies.
- Editors duplicate only into brands they're assigned to, and only their own posts are copied (they can't see others'). **Schedule structure only** copies titles, dates, times, formats, pillars and platforms.
- Cancelled items aren't copied. Unscheduled ideas are copied only when requested.
- When a day doesn't exist in the target month (e.g. the 31st), the user chooses: move to the last day, copy as an idea, or skip.
- Weekends and key dates are **reported in the preview, never moved automatically**.
- If a plan already exists for the target brand and month, copies are added to it without touching its existing posts. Archived target plans are refused.
- Any failure rolls back everything (tested by injecting a failure mid-copy).

## Activity and audit history

- `content_activity` records, per item: created, duplicated, status changes, approved, published, reopened, rescheduled, assigned, archived, restored, file attached or removed, and the names of edited fields. All members can read it.
- `workspace_audit` records member joins, role changes, deactivation and reactivation, invitations, workspace settings, brands, formats, pillars, plans and key dates. Only administrators can read it.
- Both are written only by database triggers; clients can't insert, edit or delete entries.
