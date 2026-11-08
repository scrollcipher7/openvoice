create table if not exists public.dating_private (
  user_id uuid primary key references auth.users(id) on delete cascade,
  date_of_birth date not null,
  self_attested_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.dating_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  gender text not null default '' check (gender in ('', 'male', 'female')),
  is_transgender boolean not null default false,
  about text not null default '' check (char_length(about) <= 600),
  city text not null default '' check (char_length(city) <= 120),
  looking_for text not null default 'dating'
    check (looking_for in ('friendship', 'dating', 'marriage')),
  interests text not null default '' check (char_length(interests) <= 600),
  is_visible boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.dating_profiles
  add column if not exists gender text not null default '';
alter table public.dating_profiles
  add column if not exists is_transgender boolean not null default false;

alter table public.dating_profiles
  alter column looking_for set default 'dating';

update public.dating_profiles
set looking_for = 'dating'
where looking_for not in ('friendship', 'dating', 'marriage');

alter table public.dating_profiles
  drop constraint if exists dating_profiles_looking_for_check;
alter table public.dating_profiles
  add constraint dating_profiles_looking_for_check
  check (looking_for in ('friendship', 'dating', 'marriage'));

create table if not exists public.dating_profile_photos (
  user_id uuid not null references auth.users(id) on delete cascade,
  slot text not null check (slot in ('photo_1', 'photo_2', 'photo_3', 'meme', 'ai')),
  image_url text not null check (char_length(image_url) <= 2048),
  updated_at timestamptz not null default now(),
  primary key (user_id, slot)
);

create table if not exists public.dating_verifications (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'not_started'
    check (status in ('not_started', 'requested', 'in_progress', 'selfie_checked', 'rejected')),
  requested_at timestamptz,
  checked_at timestamptz,
  checked_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.dating_likes (
  liker_id uuid not null references auth.users(id) on delete cascade,
  target_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (liker_id, target_id),
  constraint dating_likes_no_self_like check (liker_id <> target_id)
);

create table if not exists public.dating_matches (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references auth.users(id) on delete cascade,
  user_b uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint dating_matches_ordered_pair check (user_a < user_b),
  unique (user_a, user_b)
);

create table if not exists public.dating_messages (
  id bigint generated always as identity primary key,
  match_id uuid not null references public.dating_matches(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists dating_profiles_discoverable_idx
  on public.dating_profiles (updated_at desc)
  where is_visible = true;
create index if not exists dating_messages_match_created_idx
  on public.dating_messages (match_id, created_at);

create or replace function public.dating_is_adult(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.dating_private d
    where d.user_id = target_user
      and d.self_attested_at is not null
      and d.date_of_birth <= (current_date - interval '18 years')::date
      and d.date_of_birth <= current_date
  );
$$;

create or replace function public.dating_self_is_adult()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.dating_is_adult(auth.uid());
$$;

create or replace function public.dating_is_verified(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.dating_is_adult(target_user)
    and exists (
      select 1
      from public.dating_verifications v
      where v.user_id = target_user
        and v.status = 'selfie_checked'
    );
$$;

create or replace function public.dating_self_is_verified()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.dating_is_verified(auth.uid());
$$;

create or replace function public.dating_profile_is_visible(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.dating_is_verified(target_user)
    and exists (
      select 1
      from public.dating_profiles d
      where d.user_id = target_user
        and d.is_visible
    );
$$;

create or replace function public.dating_is_match_member(target_match uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.dating_matches m
    where m.id = target_match
      and auth.uid() in (m.user_a, m.user_b)
  );
$$;

create or replace function public.dating_can_use_match_call(target_match uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.dating_matches m
    where m.id = target_match
      and auth.uid() in (m.user_a, m.user_b)
      and public.dating_is_verified(m.user_a)
      and public.dating_is_verified(m.user_b)
  );
$$;

create or replace function public.dating_can_use_call_topic(target_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  match_id_text text;
begin
  if split_part(target_topic, ':', 1) <> 'dating-call' then
    return false;
  end if;
  match_id_text := split_part(target_topic, ':', 2);
  if match_id_text !~ '^[0-9a-fA-F-]{36}$' then
    return false;
  end if;
  return public.dating_can_use_match_call(match_id_text::uuid);
end;
$$;

alter table public.dating_private enable row level security;
alter table public.dating_profiles enable row level security;
alter table public.dating_profile_photos enable row level security;
alter table public.dating_verifications enable row level security;
alter table public.dating_likes enable row level security;
alter table public.dating_matches enable row level security;
alter table public.dating_messages enable row level security;

drop policy if exists dating_private_read_own on public.dating_private;
create policy dating_private_read_own
  on public.dating_private for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists dating_private_insert_own_adult on public.dating_private;
create policy dating_private_insert_own_adult
  on public.dating_private for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and date_of_birth <= (current_date - interval '18 years')::date
    and date_of_birth <= current_date
  );

drop policy if exists dating_private_update_own_adult on public.dating_private;
create policy dating_private_update_own_adult
  on public.dating_private for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and date_of_birth <= (current_date - interval '18 years')::date
    and date_of_birth <= current_date
  );

drop policy if exists dating_profiles_read_own on public.dating_profiles;
create policy dating_profiles_read_own
  on public.dating_profiles for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists dating_profiles_insert_own on public.dating_profiles;
create policy dating_profiles_insert_own
  on public.dating_profiles for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.dating_self_is_adult()
    and (not is_visible or public.dating_self_is_verified())
  );

drop policy if exists dating_profiles_update_own on public.dating_profiles;
create policy dating_profiles_update_own
  on public.dating_profiles for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and public.dating_self_is_adult()
    and (not is_visible or public.dating_self_is_verified())
  );

drop policy if exists dating_profile_photos_read_visible on public.dating_profile_photos;
create policy dating_profile_photos_read_visible
  on public.dating_profile_photos for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.dating_profile_is_visible(user_id)
  );

drop policy if exists dating_profile_photos_insert_own on public.dating_profile_photos;
create policy dating_profile_photos_insert_own
  on public.dating_profile_photos for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.dating_self_is_adult()
  );

drop policy if exists dating_profile_photos_update_own on public.dating_profile_photos;
create policy dating_profile_photos_update_own
  on public.dating_profile_photos for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and public.dating_self_is_adult()
  );

drop policy if exists dating_profile_photos_delete_own on public.dating_profile_photos;
create policy dating_profile_photos_delete_own
  on public.dating_profile_photos for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists dating_verifications_read_self_or_admin on public.dating_verifications;
create policy dating_verifications_read_self_or_admin
  on public.dating_verifications for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.is_admin = true
    )
  );

drop policy if exists dating_likes_read_own on public.dating_likes;
create policy dating_likes_read_own
  on public.dating_likes for select to authenticated
  using (liker_id = (select auth.uid()));

drop policy if exists dating_likes_insert_verified on public.dating_likes;
create policy dating_likes_insert_verified
  on public.dating_likes for insert to authenticated
  with check (
    liker_id = (select auth.uid())
    and public.dating_profile_is_visible(liker_id)
    and public.dating_profile_is_visible(target_id)
  );

drop policy if exists dating_likes_delete_own on public.dating_likes;
create policy dating_likes_delete_own
  on public.dating_likes for delete to authenticated
  using (liker_id = (select auth.uid()));

drop policy if exists dating_matches_read_member on public.dating_matches;
create policy dating_matches_read_member
  on public.dating_matches for select to authenticated
  using ((select auth.uid()) in (user_a, user_b));

drop policy if exists dating_matches_delete_member on public.dating_matches;
create policy dating_matches_delete_member
  on public.dating_matches for delete to authenticated
  using ((select auth.uid()) in (user_a, user_b));

drop policy if exists dating_messages_read_match_member on public.dating_messages;
create policy dating_messages_read_match_member
  on public.dating_messages for select to authenticated
  using (public.dating_is_match_member(match_id));

drop policy if exists dating_messages_insert_match_member on public.dating_messages;
create policy dating_messages_insert_match_member
  on public.dating_messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and public.dating_self_is_verified()
    and public.dating_is_match_member(match_id)
  );

create or replace function public.request_dating_verification()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requester uuid := auth.uid();
begin
  if requester is null or not public.dating_is_adult(requester) then
    raise exception 'Save your date of birth and confirm you are 18 or older first.';
  end if;

  insert into public.dating_verifications (user_id, status, requested_at, checked_at, checked_by)
  values (requester, 'requested', now(), null, null)
  on conflict (user_id) do update
    set status = case
      when public.dating_verifications.status = 'selfie_checked' then 'selfie_checked'
      else 'requested'
    end,
    requested_at = case
      when public.dating_verifications.status = 'selfie_checked' then public.dating_verifications.requested_at
      else now()
    end,
    checked_at = case
      when public.dating_verifications.status = 'selfie_checked' then public.dating_verifications.checked_at
      else null
    end,
    checked_by = case
      when public.dating_verifications.status = 'selfie_checked' then public.dating_verifications.checked_by
      else null
    end,
    updated_at = now();
end;
$$;

create or replace function public.get_dating_verification_requests()
returns table (
  user_id uuid,
  display_name text,
  username text,
  avatar_url text,
  requested_at timestamptz
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
         v.requested_at
  from public.dating_verifications v
  join public.profiles p on p.id = v.user_id
  where v.status = 'requested'
     or (v.status = 'in_progress' and v.checked_by = auth.uid())
  order by v.requested_at asc;
end;
$$;

create or replace function public.start_dating_selfie_check(target_user uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  reviewer uuid := auth.uid();
  changed_rows integer;
begin
  if reviewer is null or not exists (
    select 1 from public.profiles p
    where p.id = reviewer and p.is_admin = true
  ) then
    raise exception 'Admin access required.';
  end if;
  if not public.dating_is_adult(target_user) then
    raise exception 'The user has not self-attested that they are at least 18.';
  end if;

  update public.dating_verifications
  set status = 'in_progress',
      checked_by = reviewer,
      updated_at = now()
  where user_id = target_user and status = 'requested';
  get diagnostics changed_rows = row_count;
  if changed_rows <> 1 then
    raise exception 'This selfie-check request is no longer available.';
  end if;
end;
$$;

create or replace function public.release_dating_selfie_check(target_user uuid)
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

  update public.dating_verifications
  set status = 'requested',
      checked_by = null,
      checked_at = null,
      updated_at = now()
  where user_id = target_user
    and status = 'in_progress'
    and checked_by = auth.uid();
  if not found then
    raise exception 'No active selfie-check session assigned to you exists for this user.';
  end if;
end;
$$;

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
  if not exists (
    select 1 from public.dating_verifications v
    where v.user_id = target_user
      and v.status = 'in_progress'
      and v.checked_by = auth.uid()
  ) then
    raise exception 'No active selfie-check session assigned to you exists for this user.';
  end if;

  update public.dating_verifications
  set status = case when approved then 'selfie_checked' else 'rejected' end,
      checked_at = now(),
      checked_by = auth.uid(),
      updated_at = now()
  where user_id = target_user
    and status = 'in_progress'
    and checked_by = auth.uid();
  if not found then
    raise exception 'The selfie-check session is no longer assigned to you.';
  end if;
end;
$$;

create or replace function public.create_dating_match_on_mutual_like()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  first_user uuid;
  second_user uuid;
begin
  if exists (
    select 1
    from public.dating_likes l
    where l.liker_id = new.target_id and l.target_id = new.liker_id
  ) then
    first_user := least(new.liker_id, new.target_id);
    second_user := greatest(new.liker_id, new.target_id);
    insert into public.dating_matches (user_a, user_b)
    values (first_user, second_user)
    on conflict (user_a, user_b) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists dating_like_mutual_match on public.dating_likes;
create trigger dating_like_mutual_match
  after insert on public.dating_likes
  for each row execute function public.create_dating_match_on_mutual_like();

create or replace function public.remove_dating_match_on_unlike()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  first_user uuid := least(old.liker_id, old.target_id);
  second_user uuid := greatest(old.liker_id, old.target_id);
begin
  delete from public.dating_matches m
  where m.user_a = first_user and m.user_b = second_user;
  return old;
end;
$$;

drop trigger if exists dating_unlike_removes_match on public.dating_likes;
create trigger dating_unlike_removes_match
  after delete on public.dating_likes
  for each row execute function public.remove_dating_match_on_unlike();

drop function if exists public.get_dating_profiles();
create or replace function public.get_dating_profiles()
returns table (
  user_id uuid,
  display_name text,
  username text,
  avatar_url text,
  age integer,
  gender text,
  is_transgender boolean,
  city text,
  about text,
  looking_for text,
  interests text,
  photos jsonb
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.dating_profile_is_visible(auth.uid()) then
    return;
  end if;

  return query
  select dp.user_id,
         coalesce(p.display_name, p.username, 'OpenVoice member'),
         p.username,
         p.avatar_url,
         extract(year from age(current_date, priv.date_of_birth))::integer,
         dp.gender,
         dp.is_transgender,
         dp.city,
         dp.about,
         dp.looking_for,
         dp.interests,
         coalesce((
           select jsonb_agg(
             jsonb_build_object('slot', photo.slot, 'image_url', photo.image_url)
             order by photo.slot
           )
           from public.dating_profile_photos photo
           where photo.user_id = dp.user_id
         ), '[]'::jsonb)
  from public.dating_profiles dp
  join public.dating_private priv on priv.user_id = dp.user_id
  join public.dating_verifications v on v.user_id = dp.user_id and v.status = 'selfie_checked'
  join public.profiles p on p.id = dp.user_id
  where dp.is_visible
    and dp.user_id <> auth.uid()
    and public.dating_is_adult(dp.user_id)
    and not exists (
      select 1
      from public.dating_likes l
      where l.liker_id = auth.uid()
        and l.target_id = dp.user_id
    )
    and not exists (
      select 1
      from public.dating_matches m
      where auth.uid() in (m.user_a, m.user_b)
        and (dp.user_id = m.user_a or dp.user_id = m.user_b)
    )
  order by dp.updated_at desc
  limit 50;
end;
$$;

create or replace function public.get_dating_matches()
returns table (
  match_id uuid,
  other_user_id uuid,
  display_name text,
  username text,
  avatar_url text,
  matched_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.dating_profile_is_visible(auth.uid()) then
    return;
  end if;

  return query
  select m.id,
         case when m.user_a = auth.uid() then m.user_b else m.user_a end,
         coalesce(p.display_name, p.username, 'OpenVoice member'),
         p.username,
         p.avatar_url,
         m.created_at
  from public.dating_matches m
  join public.profiles p
    on p.id = case when m.user_a = auth.uid() then m.user_b else m.user_a end
  where auth.uid() in (m.user_a, m.user_b)
  order by m.created_at desc;
end;
$$;

revoke all on function public.dating_is_adult(uuid) from public, anon;
revoke all on function public.dating_self_is_adult() from public, anon;
revoke all on function public.dating_is_verified(uuid) from public, anon;
revoke all on function public.dating_self_is_verified() from public, anon;
revoke all on function public.dating_profile_is_visible(uuid) from public, anon;
revoke all on function public.dating_is_match_member(uuid) from public, anon;
revoke all on function public.dating_can_use_match_call(uuid) from public, anon;
revoke all on function public.dating_can_use_call_topic(text) from public, anon;
revoke all on function public.request_dating_verification() from public, anon;
revoke all on function public.get_dating_verification_requests() from public, anon;
revoke all on function public.start_dating_selfie_check(uuid) from public, anon;
revoke all on function public.release_dating_selfie_check(uuid) from public, anon;
revoke all on function public.review_dating_verification(uuid, boolean) from public, anon;
revoke all on function public.get_dating_profiles() from public, anon;
revoke all on function public.get_dating_matches() from public, anon;
grant execute on function public.request_dating_verification() to authenticated;
grant execute on function public.get_dating_verification_requests() to authenticated;
grant execute on function public.start_dating_selfie_check(uuid) to authenticated;
grant execute on function public.release_dating_selfie_check(uuid) to authenticated;
grant execute on function public.review_dating_verification(uuid, boolean) to authenticated;
grant execute on function public.get_dating_profiles() to authenticated;
grant execute on function public.get_dating_matches() to authenticated;
grant execute on function public.dating_self_is_adult() to authenticated;
grant execute on function public.dating_self_is_verified() to authenticated;
grant execute on function public.dating_profile_is_visible(uuid) to authenticated;
grant execute on function public.dating_is_match_member(uuid) to authenticated;
grant execute on function public.dating_can_use_match_call(uuid) to authenticated;
grant execute on function public.dating_can_use_call_topic(text) to authenticated;

revoke all on public.dating_private from anon, authenticated;
grant select, insert, update on public.dating_private to authenticated;
revoke all on public.dating_profiles from anon, authenticated;
grant select, insert, update on public.dating_profiles to authenticated;
revoke all on public.dating_profile_photos from anon, authenticated;
grant select, insert, update, delete on public.dating_profile_photos to authenticated;
revoke all on public.dating_verifications from anon, authenticated;
grant select on public.dating_verifications to authenticated;
revoke all on public.dating_likes from anon, authenticated;
grant select, insert, delete on public.dating_likes to authenticated;
revoke all on public.dating_matches from anon, authenticated;
grant select, delete on public.dating_matches to authenticated;
revoke all on public.dating_messages from anon, authenticated;
grant select, insert on public.dating_messages to authenticated;

drop policy if exists dating_call_broadcast_receive on realtime.messages;
create policy dating_call_broadcast_receive
  on realtime.messages for select to authenticated
  using (
    extension = 'broadcast'
    and public.dating_can_use_call_topic(realtime.topic())
  );

drop policy if exists dating_call_broadcast_send on realtime.messages;
create policy dating_call_broadcast_send
  on realtime.messages for insert to authenticated
  with check (
    extension = 'broadcast'
    and public.dating_can_use_call_topic(realtime.topic())
  );

drop policy if exists dating_selfie_broadcast_receive on realtime.messages;
create policy dating_selfie_broadcast_receive
  on realtime.messages for select to authenticated
  using (
    extension = 'broadcast'
    and split_part(realtime.topic(), ':', 1) = 'dating-selfie'
    and split_part(realtime.topic(), ':', 2) ~ '^[0-9a-fA-F-]{36}$'
    and (
      (
        auth.uid()::text = split_part(realtime.topic(), ':', 2)
        and exists (
          select 1 from public.dating_verifications v
          where v.user_id = auth.uid() and v.status = 'in_progress'
        )
      )
      or exists (
        select 1
        from public.profiles p
        join public.dating_verifications v
          on v.user_id::text = split_part(realtime.topic(), ':', 2)
        where p.id = auth.uid()
          and p.is_admin = true
          and v.status = 'in_progress'
          and v.checked_by = auth.uid()
      )
    )
  );

drop policy if exists dating_selfie_broadcast_send on realtime.messages;
create policy dating_selfie_broadcast_send
  on realtime.messages for insert to authenticated
  with check (
    extension = 'broadcast'
    and split_part(realtime.topic(), ':', 1) = 'dating-selfie'
    and split_part(realtime.topic(), ':', 2) ~ '^[0-9a-fA-F-]{36}$'
    and (
      (
        auth.uid()::text = split_part(realtime.topic(), ':', 2)
        and exists (
          select 1 from public.dating_verifications v
          where v.user_id = auth.uid() and v.status = 'in_progress'
        )
      )
      or exists (
        select 1
        from public.profiles p
        join public.dating_verifications v
          on v.user_id::text = split_part(realtime.topic(), ':', 2)
        where p.id = auth.uid()
          and p.is_admin = true
          and v.status = 'in_progress'
          and v.checked_by = auth.uid()
      )
    )
  );
