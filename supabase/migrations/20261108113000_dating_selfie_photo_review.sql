insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'dating-selfies',
  'dating-selfies',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

alter table public.dating_verifications
  add column if not exists selfie_path text;

update public.dating_verifications
set status = 'requested',
    checked_by = null,
    checked_at = null,
    requested_at = coalesce(requested_at, updated_at, now()),
    updated_at = now()
where status = 'in_progress';

drop policy if exists dating_selfies_read_owner_or_admin on storage.objects;
create policy dating_selfies_read_owner_or_admin
  on storage.objects for select to authenticated
  using (
    bucket_id = 'dating-selfies'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or exists (
        select 1 from public.profiles p
        where p.id = (select auth.uid()) and p.is_admin = true
      )
    )
  );

drop policy if exists dating_selfies_insert_owner on storage.objects;
create policy dating_selfies_insert_owner
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'dating-selfies'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists dating_selfies_delete_owner_or_admin on storage.objects;
create policy dating_selfies_delete_owner_or_admin
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'dating-selfies'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or exists (
        select 1 from public.profiles p
        where p.id = (select auth.uid()) and p.is_admin = true
      )
    )
  );

drop function if exists public.request_dating_verification();
create function public.request_dating_verification(selfie_object_path text)
returns void
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  requester uuid := auth.uid();
begin
  if requester is null or not public.dating_is_adult(requester) then
    raise exception 'Save your date of birth and confirm you are 18 or older first.';
  end if;
  if exists (
    select 1 from public.dating_verifications v
    where v.user_id = requester and v.status = 'selfie_checked'
  ) then
    raise exception 'Your selfie has already been checked.';
  end if;
  if selfie_object_path is null
    or (storage.foldername(selfie_object_path))[1] <> requester::text
    or not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'dating-selfies'
        and o.name = selfie_object_path
    )
  then
    raise exception 'Upload your selfie photo before requesting a review.';
  end if;

  insert into public.dating_verifications (user_id, status, requested_at, checked_at, checked_by, selfie_path)
  values (requester, 'requested', now(), null, null, selfie_object_path)
  on conflict (user_id) do update
    set status = 'requested',
        requested_at = now(),
        checked_at = null,
        checked_by = null,
        selfie_path = excluded.selfie_path,
        updated_at = now();

  update public.dating_profiles
  set is_visible = false,
      updated_at = now()
  where user_id = requester;
end;
$$;

drop function if exists public.get_dating_verification_requests();
create function public.get_dating_verification_requests()
returns table (
  user_id uuid,
  display_name text,
  username text,
  avatar_url text,
  requested_at timestamptz,
  selfie_path text,
  status text
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
  select v.user_id,
         coalesce(p.display_name, p.username, 'OpenVoice member'),
         p.username,
         p.avatar_url,
         v.requested_at,
         v.selfie_path,
         v.status
  from public.dating_verifications v
  join public.profiles p on p.id = v.user_id
  where v.selfie_path is not null
    and v.status in ('requested', 'selfie_checked', 'rejected')
  order by v.requested_at asc;
end;
$$;

drop function if exists public.start_dating_selfie_check(uuid);
drop function if exists public.release_dating_selfie_check(uuid);

create or replace function public.review_dating_verification(target_user uuid, approved boolean)
returns void
language plpgsql
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
  if not public.dating_is_adult(target_user) then
    raise exception 'The user has not self-attested that they are at least 18.';
  end if;

  update public.dating_verifications
  set status = case when approved then 'selfie_checked' else 'rejected' end,
      checked_at = now(),
      checked_by = auth.uid(),
      updated_at = now()
  where user_id = target_user
    and status = 'requested'
    and selfie_path is not null;
  if not found then
    raise exception 'This selfie photo is no longer available for review.';
  end if;
end;
$$;

create or replace function public.clear_dating_verification_selfie(target_user uuid, selfie_object_path text)
returns void
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_admin = true
  ) then
    raise exception 'Admin access required.';
  end if;
  if exists (
    select 1 from storage.objects o
    where o.bucket_id = 'dating-selfies' and o.name = selfie_object_path
  ) then
    raise exception 'The private selfie must be deleted before its review record can be cleared.';
  end if;

  update public.dating_verifications
  set selfie_path = null,
      updated_at = now()
  where user_id = target_user
    and status in ('selfie_checked', 'rejected')
    and selfie_path = selfie_object_path;
  if not found then
    raise exception 'This reviewed selfie is no longer available for cleanup.';
  end if;
end;
$$;

revoke all on function public.request_dating_verification(text) from public, anon;
revoke all on function public.get_dating_verification_requests() from public, anon;
revoke all on function public.review_dating_verification(uuid, boolean) from public, anon;
revoke all on function public.clear_dating_verification_selfie(uuid, text) from public, anon;
grant execute on function public.request_dating_verification(text) to authenticated;
grant execute on function public.get_dating_verification_requests() to authenticated;
grant execute on function public.review_dating_verification(uuid, boolean) to authenticated;
grant execute on function public.clear_dating_verification_selfie(uuid, text) to authenticated;

drop policy if exists dating_selfie_broadcast_receive on realtime.messages;
drop policy if exists dating_selfie_broadcast_send on realtime.messages;
