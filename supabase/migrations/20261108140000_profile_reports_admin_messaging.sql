alter table public.friend_conversations
  add column if not exists is_moderation boolean not null default false;

create table if not exists public.profile_reports (
  id bigint generated always as identity primary key,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_user_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (reason in (
    'Fake profile or scam',
    'Harassment',
    'Threats or violence',
    'Nudity or sexual content',
    'Other'
  )),
  details text check (details is null or char_length(details) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'dismissed')),
  created_at timestamptz not null default now(),
  constraint profile_reports_no_self check (reporter_id <> reported_user_id)
);

create unique index if not exists profile_reports_one_pending_per_reporter_idx
  on public.profile_reports (reporter_id, reported_user_id)
  where status = 'pending';

create index if not exists profile_reports_status_created_idx
  on public.profile_reports (status, created_at desc);

alter table public.profile_reports enable row level security;

drop policy if exists profile_reports_insert_self on public.profile_reports;
create policy profile_reports_insert_self
  on public.profile_reports for insert to authenticated
  with check (reporter_id = auth.uid() and reporter_id <> reported_user_id);

drop policy if exists profile_reports_read_admin on public.profile_reports;
create policy profile_reports_read_admin
  on public.profile_reports for select to authenticated
  using (exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true
  ));

drop policy if exists profile_reports_update_admin on public.profile_reports;
create policy profile_reports_update_admin
  on public.profile_reports for update to authenticated
  using (exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true
  ))
  with check (exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true
  ));

alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (type in (
    'friend_request', 'friend_accepted', 'comment', 'share',
    'feedback', 'suggestion', 'profile_report', 'moderation_message'
  ));

create or replace function public.notify_moderation_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  conversation public.friend_conversations%rowtype;
  recipient uuid;
begin
  select * into conversation
  from public.friend_conversations
  where id = new.conversation_id;

  if conversation.is_moderation then
    recipient := case
      when new.sender_id = conversation.user_a then conversation.user_b
      else conversation.user_a
    end;
    insert into public.notifications (recipient_id, actor_id, type, dedupe_key)
    values (
      recipient,
      new.sender_id,
      'moderation_message',
      'moderation-message:' || new.id::text
    )
    on conflict (recipient_id, dedupe_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists moderation_message_notifications on public.friend_messages;
create trigger moderation_message_notifications
  after insert on public.friend_messages
  for each row execute function public.notify_moderation_message();

create or replace function public.notify_profile_report()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  admin_id uuid;
begin
  for admin_id in
    select p.id from public.profiles p where p.is_admin = true
  loop
    insert into public.notifications (recipient_id, actor_id, type, dedupe_key)
    values (
      admin_id,
      new.reporter_id,
      'profile_report',
      'profile-report:' || new.id::text || ':' || admin_id::text
    )
    on conflict (recipient_id, dedupe_key) do nothing;
  end loop;
  return new;
end;
$$;

drop trigger if exists profile_report_notifications on public.profile_reports;
create trigger profile_report_notifications
  after insert on public.profile_reports
  for each row execute function public.notify_profile_report();

create or replace function public.can_access_friend_conversation(target_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.friend_conversations c
    where c.id = target_conversation
      and auth.uid() in (c.user_a, c.user_b)
      and (
        public.friends_are_connected(c.user_a, c.user_b)
        or (
          c.is_moderation
          and exists (
            select 1 from public.profiles p
            where p.id in (c.user_a, c.user_b) and p.is_admin = true
          )
        )
      )
  );
$$;

create or replace function public.create_moderation_conversation(target_user uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  admin_user uuid := auth.uid();
  conversation_id uuid;
begin
  if admin_user is null or not exists (
    select 1 from public.profiles p where p.id = admin_user and p.is_admin = true
  ) then
    raise exception 'Only an admin can start a moderation conversation.';
  end if;
  if target_user is null or target_user = admin_user or not exists (
    select 1 from public.profiles p where p.id = target_user
  ) then
    raise exception 'This member is not available.';
  end if;

  insert into public.friend_conversations (user_a, user_b, is_moderation)
  values (least(admin_user, target_user), greatest(admin_user, target_user), true)
  on conflict (user_a, user_b) do update
    set is_moderation = true
  returning id into conversation_id;

  return conversation_id;
end;
$$;

drop function if exists public.get_friend_conversations();
create or replace function public.get_friend_conversations()
returns table (
  id uuid,
  other_user_id uuid,
  display_name text,
  username text,
  avatar_url text,
  last_message text,
  last_message_at timestamptz,
  is_moderation boolean
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
         last_message.created_at,
         c.is_moderation
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
    and (
      public.friends_are_connected(c.user_a, c.user_b)
      or (
        c.is_moderation
        and exists (
          select 1 from public.profiles p
          where p.id in (c.user_a, c.user_b) and p.is_admin = true
        )
      )
    )
  order by coalesce(last_message.created_at, c.created_at) desc;
end;
$$;

drop policy if exists friend_conversations_read_member on public.friend_conversations;
create policy friend_conversations_read_member
  on public.friend_conversations for select to authenticated
  using (public.can_access_friend_conversation(id));

drop policy if exists friend_messages_read_member on public.friend_messages;
create policy friend_messages_read_member
  on public.friend_messages for select to authenticated
  using (public.can_access_friend_conversation(conversation_id));

drop policy if exists friend_messages_insert_member on public.friend_messages;
create policy friend_messages_insert_member
  on public.friend_messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.can_access_friend_conversation(conversation_id)
  );

revoke all on function public.notify_profile_report() from public, anon, authenticated;
revoke all on function public.notify_moderation_message() from public, anon, authenticated;
revoke all on function public.can_access_friend_conversation(uuid) from public, anon;
revoke all on function public.create_moderation_conversation(uuid) from public, anon;
revoke all on function public.get_friend_conversations() from public, anon;
grant execute on function public.can_access_friend_conversation(uuid) to authenticated;
grant execute on function public.create_moderation_conversation(uuid) to authenticated;
grant execute on function public.get_friend_conversations() to authenticated;

revoke all on public.profile_reports from anon, authenticated;
grant select, insert, update (status) on public.profile_reports to authenticated;
grant usage, select on sequence public.profile_reports_id_seq to authenticated;
