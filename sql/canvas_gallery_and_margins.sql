-- Phase 1: remix attribution fields on journals
alter table if exists journals
    add column if not exists is_remix boolean not null default false;

alter table if exists journals
    add column if not exists remix_source_journal_id uuid references journals(id) on delete set null;

create index if not exists journals_post_type_privacy_created_idx
    on journals(post_type, privacy, created_at desc);

create index if not exists journals_remix_source_idx
    on journals(remix_source_journal_id);

-- Phase 2: community margin layer (doodles + sticky notes)
create table if not exists canvas_margin_items (
    id uuid primary key default gen_random_uuid(),
    journal_id uuid not null references journals(id) on delete cascade,
    user_id uuid not null references users(id) on delete cascade,
    item_type text not null check (item_type in ('doodle', 'sticky')),
    payload jsonb not null,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists canvas_margin_items_journal_created_idx
    on canvas_margin_items(journal_id, created_at asc);

create index if not exists canvas_margin_items_user_idx
    on canvas_margin_items(user_id);
