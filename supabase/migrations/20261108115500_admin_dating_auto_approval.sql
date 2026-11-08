create or replace function public.dating_is_verified(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.dating_is_adult(target_user)
    and (
      exists (
        select 1
        from public.profiles p
        where p.id = target_user
          and p.is_admin = true
      )
      or exists (
        select 1
        from public.dating_verifications v
        where v.user_id = target_user
          and v.status = 'selfie_checked'
      )
    );
$$;

drop function if exists public.get_dating_profiles();
create function public.get_dating_profiles()
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
  join public.profiles p on p.id = dp.user_id
  left join public.dating_verifications v on v.user_id = dp.user_id
  where dp.is_visible
    and dp.user_id <> auth.uid()
    and public.dating_is_adult(dp.user_id)
    and (p.is_admin = true or v.status = 'selfie_checked')
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

revoke all on function public.dating_is_verified(uuid) from public, anon;
revoke all on function public.get_dating_profiles() from public, anon;
grant execute on function public.dating_is_verified(uuid) to authenticated;
grant execute on function public.get_dating_profiles() to authenticated;
