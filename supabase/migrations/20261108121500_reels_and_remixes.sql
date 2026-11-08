insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'reels',
  'reels',
  false,
  52428800,
  array['video/mp4', 'video/webm', 'video/quicktime']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.reels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  video_path text not null unique,
  caption text not null default '' check (char_length(caption) <= 280),
  source_reel_id uuid references public.reels(id) on delete set null,
  remix_style text check (remix_style in ('duet', 'react_after')),
  status text not null default 'pending_review'
    check (status in ('pending_review', 'published', 'removed')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint reels_source_and_style_match check (
    source_reel_id is null
    or (source_reel_id <> id and remix_style is not null)
  )
);

create index if not exists reels_created_at_idx on public.reels(created_at desc);
create index if not exists reels_source_reel_idx on public.reels(source_reel_id);

create table if not exists public.reel_likes (
  reel_id uuid not null references public.reels(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (reel_id, user_id)
);

create table if not exists public.reel_reports (
  id bigint generated always as identity primary key,
  reel_id uuid not null references public.reels(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (reason in ('nudity_or_sexual_content', 'violence_or_threats', 'harassment_or_doxxing', 'spam_or_other')),
  details text not null default '' check (char_length(details) <= 500),
  status text not null default 'pending' check (status in ('pending', 'reviewed')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (reel_id, reporter_id)
);

create table if not exists public.reel_bans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  banned_by uuid not null references auth.users(id) on delete restrict,
  reason text not null,
  created_at timestamptz not null default now()
);

alter table public.reels enable row level security;
alter table public.reel_likes enable row level security;
alter table public.reel_reports enable row level security;
alter table public.reel_bans enable row level security;

drop policy if exists reel_bans_read_self_or_admin on public.reel_bans;
create policy reel_bans_read_self_or_admin
  on public.reel_bans for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.is_admin = true
    )
  );

drop policy if exists reels_read_authenticated on public.reels;
create policy reels_read_authenticated
  on public.reels for select to authenticated
  using (
    status = 'published'
    or user_id = (select auth.uid())
    or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.is_admin = true
    )
  );

drop policy if exists reels_insert_owner on public.reels;
create policy reels_insert_owner
  on public.reels for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and not exists (
      select 1 from public.reel_bans b where b.user_id = (select auth.uid())
    )
    and exists (
      select 1 from storage.objects o
      where o.bucket_id = 'reels'
        and o.name = video_path
    )
    and (source_reel_id is null or source_reel_id <> id)
  );

drop policy if exists reels_delete_owner_or_admin on public.reels;
create policy reels_delete_owner_or_admin
  on public.reels for delete to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.is_admin = true
    )
  );

drop policy if exists reel_likes_read_authenticated on public.reel_likes;
create policy reel_likes_read_authenticated
  on public.reel_likes for select to authenticated
  using (true);

drop policy if exists reel_likes_insert_own on public.reel_likes;
create policy reel_likes_insert_own
  on public.reel_likes for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and not exists (select 1 from public.reel_bans b where b.user_id = (select auth.uid()))
    and exists (select 1 from public.reels r where r.id = reel_id and r.status = 'published' and r.user_id <> (select auth.uid()))
  );

drop policy if exists reel_likes_delete_own on public.reel_likes;
create policy reel_likes_delete_own
  on public.reel_likes for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists reel_reports_insert_own on public.reel_reports;
create policy reel_reports_insert_own
  on public.reel_reports for insert to authenticated
  with check (
    reporter_id = (select auth.uid())
    and not exists (select 1 from public.reel_bans b where b.user_id = (select auth.uid()))
    and exists (
      select 1 from public.reels r
      where r.id = reel_id
        and r.status = 'published'
        and r.user_id <> (select auth.uid())
    )
  );

drop policy if exists reel_reports_read_admin on public.reel_reports;
create policy reel_reports_read_admin
  on public.reel_reports for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.is_admin = true
    )
  );

drop policy if exists reels_storage_read_authenticated on storage.objects;
create policy reels_storage_read_authenticated
  on storage.objects for select to authenticated
  using (
    bucket_id = 'reels'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or exists (
        select 1 from public.reels r
        where r.video_path = name
          and (
            r.status = 'published'
            or exists (
              select 1 from public.profiles p
              where p.id = (select auth.uid()) and p.is_admin = true
            )
          )
      )
    )
  );

drop policy if exists reels_storage_insert_owner on storage.objects;
create policy reels_storage_insert_owner
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'reels'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not exists (
      select 1 from public.reel_bans b where b.user_id = (select auth.uid())
    )
  );

drop policy if exists reels_storage_delete_owner_or_admin on storage.objects;
create policy reels_storage_delete_owner_or_admin
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'reels'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or exists (
        select 1 from public.profiles p
        where p.id = (select auth.uid()) and p.is_admin = true
      )
    )
  );

create or replace function public.get_reels_feed()
returns table (
  id uuid,
  user_id uuid,
  display_name text,
  username text,
  avatar_url text,
  video_path text,
  caption text,
  source_reel_id uuid,
  remix_style text,
  created_at timestamptz,
  like_count bigint,
  liked_by_me boolean,
  source_video_path text,
  source_caption text,
  source_display_name text,
  source_username text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to view Reels.';
  end if;

  return query
  select r.id,
         r.user_id,
         coalesce(p.display_name, p.username, 'OpenVoice member'),
         p.username,
         p.avatar_url,
         r.video_path,
         r.caption,
         r.source_reel_id,
         r.remix_style,
         r.created_at,
         (select count(*) from public.reel_likes l where l.reel_id = r.id),
         exists (
           select 1 from public.reel_likes l
           where l.reel_id = r.id and l.user_id = auth.uid()
         ),
         case when source.status = 'published' then source.video_path else null end,
         source.caption,
         coalesce(source_profile.display_name, source_profile.username, 'OpenVoice member'),
         source_profile.username
  from public.reels r
  join public.profiles p on p.id = r.user_id
  left join public.reels source on source.id = r.source_reel_id
  left join public.profiles source_profile on source_profile.id = source.user_id
  where r.status = 'published'
  order by r.created_at desc
  limit 50;
end;
$$;

create or replace function public.get_reel_moderation_queue()
returns table (
  id uuid,
  user_id uuid,
  display_name text,
  username text,
  video_path text,
  caption text,
  source_reel_id uuid,
  remix_style text,
  source_video_path text,
  source_caption text,
  source_display_name text,
  report_count bigint,
  report_reasons text[],
  report_details text[],
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_admin = true
  ) then
    raise exception 'Admin access required.';
  end if;

  return query
  select r.id,
         r.user_id,
         coalesce(p.display_name, p.username, 'OpenVoice member'),
         p.username,
         r.video_path,
         r.caption,
         r.source_reel_id,
         r.remix_style,
         case when source.status = 'published' then source.video_path else null end,
         source.caption,
         coalesce(source_profile.display_name, source_profile.username, 'OpenVoice member'),
         (select count(*) from public.reel_reports rr where rr.reel_id = r.id and rr.status = 'pending'),
         coalesce((
           select array_agg(distinct rr.reason)
           from public.reel_reports rr
           where rr.reel_id = r.id and rr.status = 'pending'
         ), array[]::text[]),
         coalesce((
           select array_agg(rr.details order by rr.created_at)
           from public.reel_reports rr
           where rr.reel_id = r.id and rr.status = 'pending' and rr.details <> ''
         ), array[]::text[]),
         r.created_at
  from public.reels r
  join public.profiles p on p.id = r.user_id
  left join public.reels source on source.id = r.source_reel_id
  left join public.profiles source_profile on source_profile.id = source.user_id
  where r.status = 'pending_review'
     or exists (
       select 1 from public.reel_reports rr
       where rr.reel_id = r.id and rr.status = 'pending'
     )
  order by r.created_at asc;
end;
$$;

create or replace function public.review_reel(target_reel uuid, decision text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  creator uuid;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_admin = true
  ) then
    raise exception 'Admin access required.';
  end if;
  if decision is null or decision not in ('approve', 'remove', 'ban_for_nudity') then
    raise exception 'Invalid Reel review decision.';
  end if;

  select r.user_id into creator
  from public.reels r
  where r.id = target_reel
  for update;
  if not found then
    raise exception 'This Reel is no longer available.';
  end if;

  if decision = 'ban_for_nudity' then
    update public.reels
    set status = 'removed',
        reviewed_by = auth.uid(),
        reviewed_at = now()
    where user_id = creator;
  else
    update public.reels
    set status = case when decision = 'approve' then 'published' else 'removed' end,
        reviewed_by = auth.uid(),
        reviewed_at = now()
    where id = target_reel;
  end if;

  update public.reel_reports
  set status = 'reviewed',
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where status = 'pending'
    and reel_id in (select r.id from public.reels r where r.user_id = creator);

  if decision = 'ban_for_nudity' then
    insert into public.reel_bans (user_id, banned_by, reason)
    values (creator, auth.uid(), 'Nudity confirmed by an administrator')
    on conflict (user_id) do nothing;
  end if;
end;
$$;

revoke all on function public.get_reels_feed() from public, anon;
revoke all on function public.get_reel_moderation_queue() from public, anon;
revoke all on function public.review_reel(uuid, text) from public, anon;
grant execute on function public.get_reels_feed() to authenticated;
grant execute on function public.get_reel_moderation_queue() to authenticated;
grant execute on function public.review_reel(uuid, text) to authenticated;

revoke all on public.reels from anon, authenticated;
grant select, insert, delete on public.reels to authenticated;
revoke all on public.reel_likes from anon, authenticated;
grant insert, delete on public.reel_likes to authenticated;
revoke all on public.reel_reports from anon, authenticated;
grant insert on public.reel_reports to authenticated;
revoke all on public.reel_bans from anon, authenticated;
grant select on public.reel_bans to authenticated;
grant usage, select on sequence public.reel_reports_id_seq to authenticated;
