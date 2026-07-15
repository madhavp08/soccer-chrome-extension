create or replace function vote_choice_counts(q text)
returns table(choice text, n bigint)
language sql
security definer
set search_path = public
as $$
  select choice, count(*)::bigint as n
  from votes
  where question = q
  group by choice;
$$;

grant execute on function vote_choice_counts(text) to anon;
