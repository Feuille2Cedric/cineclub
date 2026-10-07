-- Tables indépendantes de club-33. Exécuter dans Supabase > SQL Editor.
begin;
create table if not exists public.cine_members (
 id bigint primary key, name text not null check(length(name) between 1 and 40), active boolean not null default true
);
insert into public.cine_members(id,name) values (1,'Cédric') on conflict(id) do update set name=excluded.name;
create table if not exists public.cine_proposals (
 id bigint generated always as identity primary key,
 member_id bigint not null references public.cine_members(id),
 week date not null check(extract(isodow from week)=1),
 title text not null check(length(btrim(title)) between 1 and 200),
 year text not null default '' check(year='' or year ~ '^[0-9]{4}$'),
 poster text not null default '' check(length(poster)<=500 and (poster='' or poster ~ '^https://image[.]tmdb[.]org/t/p/')),
 overview text not null default '' check(length(overview)<=5000),
 tmdb_id bigint check(tmdb_id>0), unique(member_id,week)
);
create table if not exists public.cine_draws (
 week date primary key, proposal_id bigint not null references public.cine_proposals(id), drawn_at timestamptz not null default now()
);
-- Migration additive : les propositions et notes existantes sont conservées.
alter table public.cine_proposals add column if not exists apple_id bigint check(apple_id>0);
alter table public.cine_proposals add column if not exists store_url text not null default ''
 check(length(store_url)<=2000 and (store_url='' or store_url ~ '^https://(itunes[.]apple[.]com|tv[.]apple[.]com)/'));
alter table public.cine_proposals drop constraint if exists cine_proposals_poster_check;
alter table public.cine_proposals add constraint cine_proposals_poster_check
 check(length(poster)<=500 and (poster='' or poster ~ '^https://(image[.]tmdb[.]org|([a-zA-Z0-9-]+[.])*mzstatic[.]com)/'));
create table if not exists public.cine_ratings (
 proposal_id bigint not null references public.cine_proposals(id) on delete cascade,
 member_id bigint not null references public.cine_members(id),
 seen boolean not null default false, score integer check(score between 0 and 10),
 review text not null default '' check(length(review)<=3000),
 check(score is null or seen), primary key(proposal_id,member_id)
);
alter table public.cine_members enable row level security;
alter table public.cine_proposals enable row level security;
alter table public.cine_draws enable row level security;
alter table public.cine_ratings enable row level security;
revoke all on public.cine_members, public.cine_proposals, public.cine_draws, public.cine_ratings from anon, authenticated;

create or replace function public.cine_deadline(w date) returns timestamptz
language sql immutable set search_path='' as $$
 select (w + interval '6 days 23 hours 59 minutes') at time zone 'Europe/Paris';
$$;
create or replace function public.cine_week() returns date
language sql volatile set search_path='' as $$
 select date_trunc('week', (clock_timestamp() at time zone 'Europe/Paris') + interval '1 minute')::date;
$$;

create or replace function public.cine_draw_due() returns void
language plpgsql security definer set search_path='' as $$
declare w date; chosen bigint;
begin
 -- Même verrou que les soumissions : résultat unique, même à la limite horaire.
 perform pg_advisory_xact_lock(73350335);
 for w in select distinct p.week from public.cine_proposals p
   where public.cine_deadline(p.week)<=clock_timestamp()
   and not exists(select 1 from public.cine_draws d where d.week=p.week)
 loop
   select id into chosen from public.cine_proposals where week=w order by random() limit 1;
   insert into public.cine_draws(week,proposal_id,drawn_at) values(w,chosen,clock_timestamp()) on conflict do nothing;
 end loop;
end;
$$;

create or replace function public.cine_state() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform public.cine_draw_due();
 return jsonb_build_object(
   'members',(select coalesce(jsonb_agg(to_jsonb(m) order by id),'[]'::jsonb) from public.cine_members m where active),
   'week',public.cine_week(),'deadline',public.cine_deadline(public.cine_week()),'server_time',now(),
   'proposals',(select coalesce(jsonb_agg(to_jsonb(p) order by week desc,id),'[]'::jsonb) from public.cine_proposals p),
   'draws',(select coalesce(jsonb_agg(to_jsonb(d) order by week desc),'[]'::jsonb) from public.cine_draws d),
   'ratings',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from public.cine_ratings r));
end;
$$;

create or replace function public.cine_mutate(action text, data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m bigint; w date; s integer; watched boolean;
begin
 perform pg_advisory_xact_lock(73350335);
 perform public.cine_draw_due();
 if jsonb_typeof(data->'member_id') is distinct from 'number' then raise exception 'Membre invalide.'; end if;
 m := (data->>'member_id')::bigint;
 if not exists(select 1 from public.cine_members where id=m and active) then raise exception 'Choisis un membre du club.'; end if;
 if action in ('/api/proposal','/api/remove') then
   w := public.cine_week();
   if (data->>'week') is distinct from w::text then raise exception 'Cette session est fermée. Actualise la page.'; end if;
   if exists(select 1 from public.cine_draws where week=w) then raise exception 'Le tirage a déjà eu lieu.'; end if;
   if action='/api/remove' then
     delete from public.cine_proposals where member_id=m and week=w;
   else
     insert into public.cine_proposals(member_id,week,title,year,poster,overview,tmdb_id,apple_id,store_url)
     values(m,w,btrim(data->>'title'),coalesce(data->>'year',''),coalesce(data->>'poster',''),coalesce(data->>'overview',''),(data->>'tmdb_id')::bigint,(data->>'apple_id')::bigint,coalesce(data->>'store_url',''));
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
revoke all on function public.cine_deadline(date),public.cine_week(),public.cine_draw_due(),public.cine_state(),public.cine_mutate(text,jsonb) from public,anon,authenticated;
grant execute on function public.cine_state(),public.cine_mutate(text,jsonb) to anon,authenticated;
commit;
