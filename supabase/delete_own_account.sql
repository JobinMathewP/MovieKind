-- Run once in the Supabase SQL editor.
-- Deletes the signed-in account, profile, follows, and playlists.
-- Leaves that person's review rows in place, still grouped by the old user id,
-- so recommendations keep their taste and the name is gone.

alter table public.reviews drop constraint if exists reviews_user_id_fkey;

do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select c.conname, c.conrelid::regclass as rel
    from pg_constraint c
    where c.contype = 'f'
      and c.conrelid = 'public.reviews'::regclass
      and exists (
        select 1
        from unnest(c.conkey) as key
        join pg_attribute a
          on a.attrelid = c.conrelid
         and a.attnum = key
        where a.attname = 'user_id'
      )
  loop
    execute format('alter table %s drop constraint %I', constraint_row.rel, constraint_row.conname);
  end loop;
end $$;

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  delete from public.playlist_films
  where playlist_id in (select id from public.playlists where user_id = uid);

  delete from public.playlist_likes
  where user_id = uid
     or playlist_id in (select id from public.playlists where user_id = uid);

  delete from public.playlists where user_id = uid;

  delete from public.follows
  where follower_id = uid or following_id = uid;

  delete from public.profiles where id = uid;

  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_own_account() from public;
revoke all on function public.delete_own_account() from anon;
grant execute on function public.delete_own_account() to authenticated;
