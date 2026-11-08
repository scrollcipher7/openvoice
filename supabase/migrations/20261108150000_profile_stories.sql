insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'stories',
  'stories',
  false,
  52428800,
  array[
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'video/mp4', 'video/webm', 'video/quicktime'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.profile_stories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  media_path text not null unique,
  media_type text not null check (media_type in ('image', 'video')),
  caption text not null default '' check (char_length(caption) <= 280),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  constraint profile_stories_media_path_owner check (
    media_path like user_id::text || '/%'
  )
);

create index if not exists profile_stories_expires_at_idx
  on public.profile_stories (expires_at desc);
create index if not exists profile_stories_user_created_idx
  on public.profile_stories (user_id, created_at desc);

alter table public.profile_stories enable row level security;

drop policy if exists profile_stories_read_active on public.profile_stories;
create policy profile_stories_read_active
  on public.profile_stories for select to authenticated
  using (expires_at > now() or user_id = auth.uid());

drop policy if exists profile_stories_insert_own on public.profile_stories;
create policy profile_stories_insert_own
  on public.profile_stories for insert to authenticated
  with check (
    user_id = auth.uid()
    and expires_at > now()
    and expires_at <= now() + interval '24 hours 5 minutes'
    and media_path like auth.uid()::text || '/%'
    and exists (
      select 1 from storage.objects o
      where o.bucket_id = 'stories' and o.name = media_path
    )
  );

drop policy if exists profile_stories_delete_own on public.profile_stories;
create policy profile_stories_delete_own
  on public.profile_stories for delete to authenticated
  using (user_id = auth.uid());

revoke all on public.profile_stories from anon, authenticated;
grant select, insert (user_id, media_path, media_type, caption), delete on public.profile_stories to authenticated;

drop policy if exists stories_storage_read_active on storage.objects;
create policy stories_storage_read_active
  on storage.objects for select to authenticated
  using (
    bucket_id = 'stories'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from public.profile_stories s
        where s.media_path = name and s.expires_at > now()
      )
    )
  );

drop policy if exists stories_storage_insert_own on storage.objects;
create policy stories_storage_insert_own
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'stories'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists stories_storage_delete_own on storage.objects;
create policy stories_storage_delete_own
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'stories'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
