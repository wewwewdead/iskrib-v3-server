-- Compatibility patch for older freedom wall schemas that had doodle/sticker-only checks.
-- Run this in Supabase SQL editor once.

do $$
declare
    constraint_row record;
begin
    if to_regclass('public.freedom_wall_items') is null then
        raise notice 'public.freedom_wall_items does not exist; skip patch';
        return;
    end if;

    for constraint_row in
        select conname
        from pg_constraint
        where conrelid = 'public.freedom_wall_items'::regclass
          and contype = 'c'
    loop
        execute format('alter table public.freedom_wall_items drop constraint if exists %I', constraint_row.conname);
    end loop;
end $$;

alter table public.freedom_wall_items
    add constraint freedom_wall_items_item_type_check
    check (item_type in ('doodle', 'sticker', 'stamp', 'note'));

alter table public.freedom_wall_items
    add constraint freedom_wall_items_payload_object_check
    check (jsonb_typeof(payload) = 'object');
