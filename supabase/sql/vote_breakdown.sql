-- Run in the Supabase SQL editor before / after store release.
-- Ensures vote_breakdown counts Valid/Invalid (polls) and Goal/Miss (penalties).

create or replace function vote_breakdown(q text)
returns table(total bigint, yes bigint, no bigint)
language sql
security definer
set search_path = public
as $$
  select
    (count(*) filter (where choice in ('Valid', 'Goal', 'Yes'))
      + count(*) filter (where choice in ('Invalid', 'Miss', 'No'))) as total,
    count(*) filter (where choice in ('Valid', 'Goal', 'Yes')) as yes,
    count(*) filter (where choice in ('Invalid', 'Miss', 'No')) as no
  from votes
  where question = q;
$$;

grant execute on function vote_breakdown(text) to anon;
