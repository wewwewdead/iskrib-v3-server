-- Account deletion audit trail.
-- Optional: the deletion service writes to this table best-effort and silently
-- no-ops if it does not exist, so running this migration is NOT required for the
-- feature to work. It exists purely so an admin can trace a failed deletion
-- (e.g. DB rows removed but the Supabase Auth user could not be deleted).

create table if not exists account_deletion_audit (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    username text,
    requested_at timestamptz not null default now(),
    completed_at timestamptz,
    status text not null default 'started',
    error_message text
);

-- Quick lookups of recent / unfinished deletions.
create index if not exists idx_account_deletion_audit_status_requested
    on account_deletion_audit (status, requested_at desc);
