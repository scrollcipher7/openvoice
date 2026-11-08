create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint friend_requests_no_self check (requester_id <> addressee_id),
  unique (requester_id, addressee_id)
);

create index if not exists friend_requests_addressee_status_idx
  on public.friend_requests (addressee_id, status, created_at desc);

create table if not exists public.friend_conversations (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint friend_conversations_ordered_pair check (user_a < user_b),
  unique (user_a, user_b)
);

create table if not exists public.friend_messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.friend_conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists friend_messages_conversation_created_idx
  on public.friend_messages (conversation_id, created_at);

create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('friend_request', 'friend_accepted', 'comment', 'share', 'feedback', 'suggestion')),
  post_id bigint references public.posts(id) on delete cascade,
  friend_request_id uuid references public.friend_requests(id) on delete cascade,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (recipient_id, dedupe_key)
);

create index if not exists notifications_recipient_created_idx
  on public.notifications (recipient_id, created_at desc);

create table if not exists public.profile_feedback (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  category text not null check (category in ('feedback', 'suggestion')),
  content text not null check (char_length(content) between 1 and 2000),
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now()
);

create index if not exists profile_feedback_status_created_idx
  on public.profile_feedback (status, created_at desc);

create or replace function public.notify_profile_feedback()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  admin_id uuid;
begin
  for admin_id in
    select p.id from public.profiles p where p.is_admin = true and p.id <> new.user_id
  loop
    insert into public.notifications (
      recipient_id, actor_id, type, dedupe_key
    )
    values (
      admin_id, new.user_id, new.category,
      'profile-feedback:' || new.id::text || ':' || admin_id::text
    )
    on conflict (recipient_id, dedupe_key) do nothing;
  end loop;
  return new;
end;
$$;

drop trigger if exists profile_feedback_notifications on public.profile_feedback;
create trigger profile_feedback_notifications
  after insert on public.profile_feedback
  for each row execute function public.notify_profile_feedback();

alter table public.friend_requests enable row level security;
alter table public.friend_conversations enable row level security;
alter table public.friend_messages enable row level security;
alter table public.notifications enable row level security;
alter table public.profile_feedback enable row level security;

create or replace function public.friends_are_connected(first_user uuid, second_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select first_user <> second_user and exists (
    select 1
    from public.friend_requests r
    where r.status = 'accepted'
      and (
        (r.requester_id = first_user and r.addressee_id = second_user)
        or (r.requester_id = second_user and r.addressee_id = first_user)
      )
  );
$$;

create or replace function public.create_friend_conversation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'accepted' and tg_op = 'INSERT' then
    insert into public.friend_conversations (user_a, user_b)
    values (least(new.requester_id, new.addressee_id), greatest(new.requester_id, new.addressee_id))
    on conflict (user_a, user_b) do nothing;
  elsif new.status = 'accepted' and tg_op = 'UPDATE' and old.status is distinct from 'accepted' then
    insert into public.friend_conversations (user_a, user_b)
    values (least(new.requester_id, new.addressee_id), greatest(new.requester_id, new.addressee_id))
    on conflict (user_a, user_b) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists friend_request_create_conversation on public.friend_requests;
create trigger friend_request_create_conversation
  after insert or update of status on public.friend_requests
  for each row execute function public.create_friend_conversation();

create or replace function public.notify_friend_request()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'pending' then
    insert into public.notifications (
      recipient_id, actor_id, type, friend_request_id, dedupe_key
    )
    values (
      new.addressee_id, new.requester_id, 'friend_request', new.id,
      'friend-request:' || new.id::text || ':' || new.created_at::text
    )
    on conflict (recipient_id, dedupe_key) do nothing;
  elsif tg_op = 'UPDATE' and new.status = 'accepted' and old.status = 'pending' then
    insert into public.notifications (
      recipient_id, actor_id, type, friend_request_id, dedupe_key
    )
    values (
      new.requester_id, new.addressee_id, 'friend_accepted', new.id,
      'friend-accepted:' || new.id::text
    )
    on conflict (recipient_id, dedupe_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists friend_request_notifications on public.friend_requests;
create trigger friend_request_notifications
  after insert or update of status on public.friend_requests
  for each row execute function public.notify_friend_request();

create or replace function public.notify_post_comment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  post_owner uuid;
begin
  select p.user_id into post_owner
  from public.posts p
  where p.id = new.post_id;

  if post_owner is not null and post_owner <> new.user_id then
    insert into public.notifications (
      recipient_id, actor_id, type, post_id, dedupe_key
    )
    values (
      post_owner, new.user_id, 'comment', new.post_id,
      'comment:' || new.id::text
    )
    on conflict (recipient_id, dedupe_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists comment_notifications on public.comments;
create trigger comment_notifications
  after insert on public.comments
  for each row execute function public.notify_post_comment();

create or replace function public.notify_post_share(target_post bigint)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  post_owner uuid;
begin
  if actor is null then
    raise exception 'Sign in to share a post.';
  end if;

  select p.user_id into post_owner
  from public.posts p
  where p.id = target_post;
  if post_owner is null then
    raise exception 'This post is no longer available.';
  end if;

  if post_owner <> actor then
    insert into public.notifications (
      recipient_id, actor_id, type, post_id, dedupe_key
    )
    values (
      post_owner, actor, 'share', target_post,
      'share:' || actor::text || ':' || target_post::text
    )
    on conflict (recipient_id, dedupe_key) do update
      set created_at = now(), read_at = null;
  end if;
end;
$$;

create or replace function public.create_friend_request(target_user uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requester uuid := auth.uid();
  request_id uuid;
begin
  if requester is null then
    raise exception 'Sign in to add a friend.';
  end if;
  if target_user is null or target_user = requester then
    raise exception 'You cannot add yourself as a friend.';
  end if;
  if not exists (select 1 from public.profiles p where p.id = target_user) then
    raise exception 'This profile is no longer available.';
  end if;
  if public.friends_are_connected(requester, target_user) then
    raise exception 'You are already friends.';
  end if;

  select r.id into request_id
  from public.friend_requests r
  where r.requester_id = target_user
    and r.addressee_id = requester
    and r.status = 'pending'
  for update;
  if request_id is not null then
    update public.friend_requests
    set status = 'accepted', responded_at = now()
    where id = request_id;
    return request_id;
  end if;

  insert into public.friend_requests (requester_id, addressee_id)
  values (requester, target_user)
  on conflict (requester_id, addressee_id) do update
    set status = 'pending', created_at = now(), responded_at = null
    where public.friend_requests.status = 'declined'
  returning id into request_id;

  if request_id is null then
    raise exception 'A friend request is already pending.';
  end if;
  return request_id;
end;
$$;

create or replace function public.respond_friend_request(target_request uuid, accept_request boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to respond to friend requests.';
  end if;

  update public.friend_requests
  set status = case when accept_request then 'accepted' else 'declined' end,
      responded_at = now()
  where id = target_request
    and addressee_id = auth.uid()
    and status = 'pending';

  if not found then
    raise exception 'This friend request is no longer pending.';
  end if;

  update public.notifications
  set read_at = coalesce(read_at, now())
  where recipient_id = auth.uid()
    and friend_request_id = target_request;
end;
$$;

create or replace function public.get_friend_conversations()
returns table (
  id uuid,
  other_user_id uuid,
  display_name text,
  username text,
  avatar_url text,
  last_message text,
  last_message_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to view your messages.';
  end if;

  return query
  select c.id,
         peer.id,
         coalesce(peer.display_name, peer.username, 'OpenVoice member'),
         peer.username,
         peer.avatar_url,
         last_message.content,
         last_message.created_at
  from public.friend_conversations c
  join public.profiles peer
    on peer.id = case when c.user_a = auth.uid() then c.user_b else c.user_a end
  left join lateral (
    select m.content, m.created_at
    from public.friend_messages m
    where m.conversation_id = c.id
    order by m.created_at desc
    limit 1
  ) last_message on true
  where auth.uid() in (c.user_a, c.user_b)
    and public.friends_are_connected(c.user_a, c.user_b)
  order by coalesce(last_message.created_at, c.created_at) desc;
end;
$$;

create or replace function public.friends_can_use_call_topic(target_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  conversation_text text;
  conversation_id uuid;
begin
  if split_part(target_topic, ':', 1) <> 'friend-call' then
    return false;
  end if;
  conversation_text := split_part(target_topic, ':', 2);
  if conversation_text !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return false;
  end if;
  conversation_id := conversation_text::uuid;

  return exists (
    select 1
    from public.friend_conversations c
    where c.id = conversation_id
      and auth.uid() in (c.user_a, c.user_b)
      and public.friends_are_connected(c.user_a, c.user_b)
  );
end;
$$;

drop policy if exists friend_requests_read_participant on public.friend_requests;
create policy friend_requests_read_participant
  on public.friend_requests for select to authenticated
  using (auth.uid() in (requester_id, addressee_id));

drop policy if exists friend_conversations_read_member on public.friend_conversations;
create policy friend_conversations_read_member
  on public.friend_conversations for select to authenticated
  using (
    auth.uid() in (user_a, user_b)
    and public.friends_are_connected(user_a, user_b)
  );

drop policy if exists friend_messages_read_member on public.friend_messages;
create policy friend_messages_read_member
  on public.friend_messages for select to authenticated
  using (
    exists (
      select 1
      from public.friend_conversations c
      where c.id = conversation_id
        and auth.uid() in (c.user_a, c.user_b)
        and public.friends_are_connected(c.user_a, c.user_b)
    )
  );

drop policy if exists friend_messages_insert_member on public.friend_messages;
create policy friend_messages_insert_member
  on public.friend_messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1
      from public.friend_conversations c
      where c.id = conversation_id
        and auth.uid() in (c.user_a, c.user_b)
        and public.friends_are_connected(c.user_a, c.user_b)
    )
  );

drop policy if exists notifications_read_recipient on public.notifications;
create policy notifications_read_recipient
  on public.notifications for select to authenticated
  using (recipient_id = auth.uid());

drop policy if exists notifications_update_read_recipient on public.notifications;
create policy notifications_update_read_recipient
  on public.notifications for update to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

drop policy if exists profile_feedback_insert_self on public.profile_feedback;
create policy profile_feedback_insert_self
  on public.profile_feedback for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists profile_feedback_read_admin on public.profile_feedback;
create policy profile_feedback_read_admin
  on public.profile_feedback for select to authenticated
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  );

drop policy if exists profile_feedback_update_admin on public.profile_feedback;
create policy profile_feedback_update_admin
  on public.profile_feedback for update to authenticated
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  );

drop policy if exists friend_call_broadcast_receive on realtime.messages;
create policy friend_call_broadcast_receive
  on realtime.messages for select to authenticated
  using (
    extension = 'broadcast'
    and public.friends_can_use_call_topic(realtime.topic())
  );

drop policy if exists friend_call_broadcast_send on realtime.messages;
create policy friend_call_broadcast_send
  on realtime.messages for insert to authenticated
  with check (
    extension = 'broadcast'
    and public.friends_can_use_call_topic(realtime.topic())
  );

revoke all on function public.friends_are_connected(uuid, uuid) from public, anon;
revoke all on function public.create_friend_conversation() from public, anon, authenticated;
revoke all on function public.notify_friend_request() from public, anon, authenticated;
revoke all on function public.notify_post_comment() from public, anon, authenticated;
revoke all on function public.notify_profile_feedback() from public, anon, authenticated;
revoke all on function public.notify_post_share(bigint) from public, anon;
revoke all on function public.create_friend_request(uuid) from public, anon;
revoke all on function public.respond_friend_request(uuid, boolean) from public, anon;
revoke all on function public.get_friend_conversations() from public, anon;
revoke all on function public.friends_can_use_call_topic(text) from public, anon;

grant execute on function public.friends_are_connected(uuid, uuid) to authenticated;
grant execute on function public.notify_post_share(bigint) to authenticated;
grant execute on function public.create_friend_request(uuid) to authenticated;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;
grant execute on function public.get_friend_conversations() to authenticated;
grant execute on function public.friends_can_use_call_topic(text) to authenticated;

revoke all on public.friend_requests from anon, authenticated;
grant select on public.friend_requests to authenticated;
revoke all on public.friend_conversations from anon, authenticated;
grant select on public.friend_conversations to authenticated;
revoke all on public.friend_messages from anon, authenticated;
grant select, insert on public.friend_messages to authenticated;
revoke all on public.notifications from anon, authenticated;
grant select, update (read_at) on public.notifications to authenticated;
revoke all on public.profile_feedback from anon, authenticated;
grant select, insert (user_id, category, content), update (status) on public.profile_feedback to authenticated;
