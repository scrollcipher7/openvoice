create table if not exists public.live_streams (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles(id) on delete cascade,
  title text not null default '' check (char_length(title) <= 120),
  status text not null default 'live' check (status in ('live', 'ended')),
  created_at timestamptz not null default now(),
  ended_at timestamptz
);

create index if not exists live_streams_active_created_idx
  on public.live_streams (created_at desc) where status = 'live';

create table if not exists public.live_viewers (
  live_id uuid not null references public.live_streams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  primary key (live_id, user_id)
);

create table if not exists public.live_guest_requests (
  id uuid primary key default gen_random_uuid(),
  live_id uuid not null references public.live_streams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'left')),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  last_seen_at timestamptz
);

create unique index if not exists live_guest_requests_one_open_idx
  on public.live_guest_requests (live_id, user_id)
  where status in ('pending', 'approved');
create index if not exists live_guest_requests_room_status_idx
  on public.live_guest_requests (live_id, status, created_at desc);

create table if not exists public.live_chat_messages (
  id uuid primary key default gen_random_uuid(),
  live_id uuid not null references public.live_streams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists live_chat_messages_room_created_idx
  on public.live_chat_messages (live_id, created_at desc);

alter table public.live_streams enable row level security;
alter table public.live_viewers enable row level security;
alter table public.live_guest_requests enable row level security;
alter table public.live_chat_messages enable row level security;

drop policy if exists live_streams_read_active on public.live_streams;
create policy live_streams_read_active
  on public.live_streams for select to authenticated
  using (status = 'live' or host_id = auth.uid());

drop policy if exists live_streams_insert_own on public.live_streams;
create policy live_streams_insert_own
  on public.live_streams for insert to authenticated
  with check (host_id = auth.uid() and status = 'live');

drop policy if exists live_streams_end_own on public.live_streams;
create policy live_streams_end_own
  on public.live_streams for update to authenticated
  using (host_id = auth.uid() and status = 'live')
  with check (host_id = auth.uid() and status = 'ended');

drop policy if exists live_guest_requests_read_owner_or_host on public.live_guest_requests;
create policy live_guest_requests_read_owner_or_host
  on public.live_guest_requests for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.live_streams s
      where s.id = live_id and s.host_id = auth.uid() and s.status = 'live'
    )
  );

drop policy if exists live_guest_requests_insert_own on public.live_guest_requests;
create policy live_guest_requests_insert_own
  on public.live_guest_requests for insert to authenticated
  with check (
    user_id = auth.uid()
    and status = 'pending'
    and exists (
      select 1 from public.live_streams s
      where s.id = live_id and s.status = 'live' and s.host_id <> auth.uid()
    )
  );

drop policy if exists live_chat_read_active on public.live_chat_messages;
create policy live_chat_read_active
  on public.live_chat_messages for select to authenticated
  using (exists (
    select 1 from public.live_streams s where s.id = live_id and s.status = 'live'
  ));

drop policy if exists live_chat_insert_active on public.live_chat_messages;
create policy live_chat_insert_active
  on public.live_chat_messages for insert to authenticated
  with check (
    user_id = auth.uid()
    and char_length(content) between 1 and 500
    and exists (
      select 1 from public.live_streams s where s.id = live_id and s.status = 'live'
    )
  );

create or replace function public.live_can_use_topic(target_topic text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and target_topic ~ '^openvoice-live:[0-9a-fA-F-]{36}$'
    and exists (
      select 1 from public.live_streams s
      where s.id::text = split_part(target_topic, ':', 2)
        and s.status = 'live'
        and (
          s.host_id = auth.uid()
          or exists (
            select 1 from public.live_viewers v
            where v.live_id = s.id and v.user_id = auth.uid()
              and v.last_seen_at > now() - interval '45 seconds'
          )
          or exists (
            select 1 from public.live_guest_requests r
            where r.live_id = s.id and r.user_id = auth.uid() and r.status = 'approved'
              and (
                r.last_seen_at > now() - interval '45 seconds'
                or r.approved_at > now() - interval '1 minute'
              )
          )
        )
    );
$$;

create or replace function public.join_live_viewer(target_live uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  host_user uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to watch a Live.'; end if;
  select host_id into host_user from public.live_streams
    where id = target_live and status = 'live'
    for update;
  if host_user is null then raise exception 'This Live has ended.'; end if;
  if host_user = auth.uid() then return; end if;

  insert into public.live_viewers (live_id, user_id, last_seen_at)
  values (target_live, auth.uid(), now())
  on conflict (live_id, user_id) do update set last_seen_at = excluded.last_seen_at;

  if (select count(*) from public.live_viewers
      where live_id = target_live and last_seen_at > now() - interval '45 seconds') > 5 then
    delete from public.live_viewers where live_id = target_live and user_id = auth.uid();
    raise exception 'This Live has reached its 5-viewer limit.';
  end if;
end;
$$;

create or replace function public.heartbeat_live_viewer(target_live uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.live_viewers v set last_seen_at = now()
  where v.live_id = target_live and v.user_id = auth.uid()
    and exists (select 1 from public.live_streams s where s.id = target_live and s.status = 'live');
end;
$$;

create or replace function public.leave_live_viewer(target_live uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.live_viewers where live_id = target_live and user_id = auth.uid();
$$;

create or replace function public.request_live_guest(target_live uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  request_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to request to join.'; end if;
  if not exists (
    select 1 from public.live_streams
    where id = target_live and status = 'live' and host_id <> auth.uid()
  ) then raise exception 'This Live is no longer available.'; end if;

  insert into public.live_guest_requests (live_id, user_id, status)
  values (target_live, auth.uid(), 'pending')
  returning id into request_id;
  return request_id;
end;
$$;

create or replace function public.approve_live_guest(target_request uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_live uuid;
  host_user uuid;
  active_guests integer;
begin
  select r.live_id, s.host_id into target_live, host_user
  from public.live_guest_requests r
  join public.live_streams s on s.id = r.live_id
  where r.id = target_request and r.status = 'pending' and s.status = 'live';
  if target_live is null or host_user <> auth.uid() then
    raise exception 'This guest request is no longer available.';
  end if;
  perform 1 from public.live_streams where id = target_live for update;
  select count(*) into active_guests
  from public.live_guest_requests r
  where r.live_id = target_live and r.status = 'approved'
    and (
      r.last_seen_at > now() - interval '45 seconds'
      or r.approved_at > now() - interval '1 minute'
    );
  if active_guests >= 2 then raise exception 'This Live already has two guest spots filled.'; end if;

  update public.live_guest_requests
  set status = 'approved', approved_at = now(), last_seen_at = null
  where id = target_request and status = 'pending';
end;
$$;

create or replace function public.deny_live_guest(target_request uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.live_guest_requests r set status = 'denied'
  where r.id = target_request and r.status = 'pending'
    and exists (
      select 1 from public.live_streams s
      where s.id = r.live_id and s.host_id = auth.uid() and s.status = 'live'
    );
  if not found then raise exception 'This guest request is no longer available.'; end if;
end;
$$;

create or replace function public.join_live_guest(target_live uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  active_guests integer;
begin
  if auth.uid() is null then raise exception 'Sign in to join as a guest.'; end if;
  perform 1 from public.live_streams where id = target_live and status = 'live' for update;
  if not found then raise exception 'This Live has ended.'; end if;

  if not exists (
    select 1 from public.live_guest_requests
    where live_id = target_live and user_id = auth.uid() and status = 'approved'
  ) then raise exception 'The host has not approved your request.'; end if;

  select count(*) into active_guests
  from public.live_guest_requests r
  where r.live_id = target_live and r.user_id <> auth.uid() and r.status = 'approved'
    and (
      r.last_seen_at > now() - interval '45 seconds'
      or r.approved_at > now() - interval '1 minute'
    );
  if active_guests >= 2 then raise exception 'This Live already has two guest spots filled.'; end if;

  update public.live_guest_requests
  set last_seen_at = now()
  where live_id = target_live and user_id = auth.uid() and status = 'approved';
end;
$$;

create or replace function public.heartbeat_live_guest(target_live uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.live_guest_requests set last_seen_at = now()
  where live_id = target_live and user_id = auth.uid() and status = 'approved'
    and exists (select 1 from public.live_streams s where s.id = target_live and s.status = 'live');
$$;

create or replace function public.leave_live_guest(target_live uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.live_guest_requests
  set status = 'left', last_seen_at = null
  where live_id = target_live and user_id = auth.uid() and status = 'approved';
$$;

drop policy if exists live_broadcast_receive on realtime.messages;
create policy live_broadcast_receive
  on realtime.messages for select to authenticated
  using (
    extension = 'broadcast'
    and public.live_can_use_topic(realtime.topic())
  );

drop policy if exists live_broadcast_send on realtime.messages;
create policy live_broadcast_send
  on realtime.messages for insert to authenticated
  with check (
    extension = 'broadcast'
    and public.live_can_use_topic(realtime.topic())
  );

drop policy if exists live_presence_receive on realtime.messages;
create policy live_presence_receive
  on realtime.messages for select to authenticated
  using (
    extension = 'presence'
    and public.live_can_use_topic(realtime.topic())
  );

drop policy if exists live_presence_send on realtime.messages;
create policy live_presence_send
  on realtime.messages for insert to authenticated
  with check (
    extension = 'presence'
    and public.live_can_use_topic(realtime.topic())
  );

revoke all on function public.live_can_use_topic(text) from public, anon;
revoke all on function public.join_live_viewer(uuid) from public, anon;
revoke all on function public.heartbeat_live_viewer(uuid) from public, anon;
revoke all on function public.leave_live_viewer(uuid) from public, anon;
revoke all on function public.request_live_guest(uuid) from public, anon;
revoke all on function public.approve_live_guest(uuid) from public, anon;
revoke all on function public.deny_live_guest(uuid) from public, anon;
revoke all on function public.join_live_guest(uuid) from public, anon;
revoke all on function public.heartbeat_live_guest(uuid) from public, anon;
revoke all on function public.leave_live_guest(uuid) from public, anon;
grant execute on function public.live_can_use_topic(text) to authenticated;
grant execute on function public.join_live_viewer(uuid) to authenticated;
grant execute on function public.heartbeat_live_viewer(uuid) to authenticated;
grant execute on function public.leave_live_viewer(uuid) to authenticated;
grant execute on function public.request_live_guest(uuid) to authenticated;
grant execute on function public.approve_live_guest(uuid) to authenticated;
grant execute on function public.deny_live_guest(uuid) to authenticated;
grant execute on function public.join_live_guest(uuid) to authenticated;
grant execute on function public.heartbeat_live_guest(uuid) to authenticated;
grant execute on function public.leave_live_guest(uuid) to authenticated;

revoke all on public.live_streams, public.live_viewers, public.live_guest_requests, public.live_chat_messages
  from anon, authenticated;
grant select on public.live_streams to authenticated;
grant insert (host_id, title) on public.live_streams to authenticated;
grant update (status, ended_at) on public.live_streams to authenticated;
grant select on public.live_guest_requests to authenticated;
grant select on public.live_chat_messages to authenticated;
grant insert (live_id, user_id, content) on public.live_chat_messages to authenticated;
