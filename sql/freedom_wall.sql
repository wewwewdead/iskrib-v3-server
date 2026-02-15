create extension if not exists pgcrypto;

create table if not exists public.freedom_wall_weeks (
    id uuid primary key default gen_random_uuid(),
    week_start timestamptz not null,
    week_end timestamptz not null,
    status text not null default 'active'
        check (status in ('active', 'archived')),
    created_at timestamptz not null default timezone('utc', now()),
    check (week_end > week_start),
    unique (week_start)
);

create unique index if not exists freedom_wall_weeks_one_active_idx
    on public.freedom_wall_weeks (status)
    where status = 'active';

create index if not exists freedom_wall_weeks_status_start_idx
    on public.freedom_wall_weeks (status, week_start desc);

create index if not exists freedom_wall_weeks_start_end_idx
    on public.freedom_wall_weeks (week_start desc, week_end desc);

create table if not exists public.freedom_wall_stickers (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    asset_url text not null,
    is_active boolean not null default true,
    created_at timestamptz not null default timezone('utc', now()),
    unique (name),
    unique (asset_url)
);

create index if not exists freedom_wall_stickers_active_name_idx
    on public.freedom_wall_stickers (is_active, name);

create table if not exists public.freedom_wall_items (
    id uuid primary key default gen_random_uuid(),
    week_id uuid not null references public.freedom_wall_weeks(id) on delete cascade,
    user_id uuid not null references public.users(id) on delete cascade,
    item_type text not null check (item_type in ('doodle', 'sticker', 'stamp', 'note')),
    payload jsonb not null check (jsonb_typeof(payload) = 'object'),
    z_index integer not null default 0,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    deleted_at timestamptz null
);

create or replace function public.set_updated_at_freedom_wall_items()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = timezone('utc', now());
    return new;
end;
$$;

drop trigger if exists trg_set_updated_at_freedom_wall_items on public.freedom_wall_items;
create trigger trg_set_updated_at_freedom_wall_items
before update on public.freedom_wall_items
for each row
execute function public.set_updated_at_freedom_wall_items();

create index if not exists freedom_wall_items_week_visible_z_idx
    on public.freedom_wall_items (week_id, z_index asc, created_at asc)
    where deleted_at is null;

create index if not exists freedom_wall_items_week_visible_created_idx
    on public.freedom_wall_items (week_id, created_at desc)
    where deleted_at is null;

create index if not exists freedom_wall_items_week_type_visible_created_idx
    on public.freedom_wall_items (week_id, item_type, created_at desc)
    where deleted_at is null;

create index if not exists freedom_wall_items_user_visible_created_idx
    on public.freedom_wall_items (user_id, created_at desc)
    where deleted_at is null;

create index if not exists freedom_wall_items_payload_gin_idx
    on public.freedom_wall_items using gin (payload jsonb_path_ops);
