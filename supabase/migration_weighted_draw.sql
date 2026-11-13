create or replace function public.cine_mutate(action text, data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m bigint; w date; s integer; watched boolean; chosen bigint;
begin
 perform pg_advisory_xact_lock(73350335);
 if action='/api/member' then
   if jsonb_typeof(data->'name') is distinct from 'string' or length(btrim(data->>'name')) not between 1 and 40 then raise exception 'Prénom invalide.'; end if;
   insert into public.cine_members(id,name)
   select coalesce(max(id),0)+1,btrim(data->>'name') from public.cine_members;
   return jsonb_build_object('ok',true);
 end if;
 if jsonb_typeof(data->'member_id') is distinct from 'number' then raise exception 'Membre invalide.'; end if;
 m := (data->>'member_id')::bigint;
 if not exists(select 1 from public.cine_members where id=m and active) then raise exception 'Choisis un membre du club.'; end if;
 if action='/api/draw' then
   if m<>1 then raise exception 'Seul Cédric peut lancer le tirage.'; end if;
   w := (data->>'week')::date;
   if w is null or w::text<>(data->>'week') or extract(isodow from w)<>1 or w>public.cine_week() then raise exception 'Session invalide.'; end if;
   select proposal_id into chosen from public.cine_draws where week=w;
   if found then return jsonb_build_object('ok',true,'proposal_id',chosen,'already_drawn',true); end if;
   with past_draws as (
     select p.member_id,row_number() over(order by d.week) as draw_number
     from public.cine_draws d join public.cine_proposals p on p.id=d.proposal_id where d.week<w
   ), last_wins as (
     select member_id,max(draw_number) as last_draw_number from past_draws group by member_id
   ), rounds as (select count(*)::bigint as total from past_draws),
   candidates as (
     select p.id,least(5,greatest(1,r.total-coalesce(l.last_draw_number,0)+1))::bigint as tickets
     from public.cine_proposals p cross join rounds r left join last_wins l on l.member_id=p.member_id where p.week=w
   ), ranges as (
     select id,sum(tickets) over(order by id) as upper_bound from candidates
   ), target as (select random()*(select coalesce(sum(tickets),0) from candidates) as value)
   select ranges.id into chosen from ranges,target where ranges.upper_bound>target.value order by ranges.upper_bound limit 1;
   if not found then raise exception 'Il faut au moins une proposition pour lancer le tirage.'; end if;
   insert into public.cine_draws(week,proposal_id,drawn_at) values(w,chosen,clock_timestamp());
   return jsonb_build_object('ok',true,'proposal_id',chosen,'already_drawn',false);
 elsif action in ('/api/proposal','/api/remove') then
   w := public.cine_week();
   if (data->>'week') is distinct from w::text then raise exception 'Cette session est fermée. Actualise la page.'; end if;
   if exists(select 1 from public.cine_draws where week=w) then raise exception 'Le tirage a déjà eu lieu.'; end if;
   if action='/api/remove' then
     delete from public.cine_proposals where member_id=m and week=w;
   else
     insert into public.cine_proposals(member_id,week,title,year,poster,overview,director,tmdb_id,apple_id,store_url)
     values(m,w,btrim(data->>'title'),coalesce(data->>'year',''),coalesce(data->>'poster',''),coalesce(data->>'overview',''),coalesce(data->>'director',''),(data->>'tmdb_id')::bigint,(data->>'apple_id')::bigint,coalesce(data->>'store_url',''));
   end if;
 elsif action='/api/rating' then
   if jsonb_typeof(data->'seen') is distinct from 'boolean' then raise exception 'État de visionnage invalide.'; end if;
   watched := (data->>'seen')::boolean;
   if data->>'score' is not null and (jsonb_typeof(data->'score')<>'number' or (data->>'score') !~ '^[0-9]+$') then raise exception 'Note invalide.'; end if;
   s := (data->>'score')::integer;
   insert into public.cine_ratings(proposal_id,member_id,seen,score,review)
   values((data->>'proposal_id')::bigint,m,watched,s,coalesce(data->>'review',''))
   on conflict(proposal_id,member_id) do update set seen=excluded.seen,score=excluded.score,review=excluded.review;
 else raise exception 'Action inconnue.';
 end if;
 return jsonb_build_object('ok',true);
exception when unique_violation then
 raise exception 'Tu as déjà proposé un film pour cette session. Retire-le pour en choisir un autre.';
end;
$$;
