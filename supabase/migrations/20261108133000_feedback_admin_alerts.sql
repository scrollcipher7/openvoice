alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (type in ('friend_request', 'friend_accepted', 'comment', 'share', 'feedback', 'suggestion'));

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

revoke all on function public.notify_profile_feedback() from public, anon, authenticated;
