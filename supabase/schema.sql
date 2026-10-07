-- Tables indÃ©pendantes de club-33. ExÃ©cuter dans Supabase > SQL Editor.
begin;
create table if not exists public.cine_members (
 id bigint primary key, name text not null check(length(name) between 1 and 40), active boolean not null default true
);
insert into public.cine_members(id,name) values (1,'CÃ©dric') on conflict(id) do update set name=excluded.name;
create unique index if not exists cine_members_name_unique on public.cine_members(lower(btrim(name)));
create table if not exists public.cine_proposals (
 id bigint generated always as identity primary key,
 member_id bigint not null references public.cine_members(id),
 week date not null check(extract(isodow from week)=1),
 title text not null check(length(btrim(title)) between 1 and 200),
 year text not null default '' check(year='' or year ~ '^[0-9]{4}$'),
 poster text not null default '' check(length(poster)<=500 and (poster='' or poster ~ '^https://image[.]tmdb[.]org/t/p/')),
 overview text not null default '' check(length(overview)<=5000),
 director text not null default '' check(length(director)<=200),
 tmdb_id bigint check(tmdb_id>0), unique(member_id,week)
);
create table if not exists public.cine_draws (
 week date primary key, proposal_id bigint not null references public.cine_proposals(id), drawn_at timestamptz not null default now()
);
-- Migration additive : les propositions et notes existantes sont conservÃ©es.
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
 select date_trunc('week', clock_timestamp() at time zone 'Europe/Paris')::date;
$$;

create or replace function public.cine_draw_due() returns void
language plpgsql security definer set search_path='' as $$
begin
 -- CompatibilitÃ© : un ancien cron ne peut plus dÃ©clencher de tirage.
 return;
end;
$$;

-- Retire uniquement le cron du cinÃ©club, si cette extension a Ã©tÃ© activÃ©e.
do $$ declare job bigint; begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
   for job in execute 'select jobid from cron.job where jobname=''cineclub-weekly-draw''' loop
     execute 'select cron.unschedule($1)' using job;
   end loop;
 end if;
end $$;

create or replace function public.cine_state() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 return jsonb_build_object(
   'members',(select coalesce(jsonb_agg(to_jsonb(m) order by id),'[]'::jsonb) from public.cine_members m where active),
   'week',public.cine_week(),'draw_admin_id',1,'server_time',now(),
   'proposals',(select coalesce(jsonb_agg(to_jsonb(p) order by week desc,id),'[]'::jsonb) from public.cine_proposals p),
   'draws',(select coalesce(jsonb_agg(to_jsonb(d) order by week desc),'[]'::jsonb) from public.cine_draws d),
   'ratings',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from public.cine_ratings r));
end;
$$;

create or replace function public.cine_mutate(action text, data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m bigint; w date; s integer; watched boolean; chosen bigint;
begin
 perform pg_advisory_xact_lock(73350335);
 if action='/api/member' then
   if jsonb_typeof(data->'name') is distinct from 'string' or length(btrim(data->>'name')) not between 1 and 40 then raise exception 'PrÃ©nom invalide.'; end if;
   insert into public.cine_members(id,name)
   select coalesce(max(id),0)+1,btrim(data->>'name') from public.cine_members;
   return jsonb_build_object('ok',true);
 end if;
 if jsonb_typeof(data->'member_id') is distinct from 'number' then raise exception 'Membre invalide.'; end if;
 m := (data->>'member_id')::bigint;
 if not exists(select 1 from public.cine_members where id=m and active) then raise exception 'Choisis un membre du club.'; end if;
 if action='/api/draw' then
   if m<>1 then raise exception 'Seul CÃ©dric peut lancer le tirage.'; end if;
   w := (data->>'week')::date;
   if w is null or w::text<>(data->>'week') or extract(isodow from w)<>1 or w>public.cine_week() then
     raise exception 'Session invalide.';
   end if;
   select proposal_id into chosen from public.cine_draws where week=w;
   if found then return jsonb_build_object('ok',true,'proposal_id',chosen,'already_drawn',true); end if;
   select id into chosen from public.cine_proposals where week=w order by random() limit 1;
   if not found then raise exception 'Il faut au moins une proposition pour lancer le tirage.'; end if;
   insert into public.cine_draws(week,proposal_id,drawn_at) values(w,chosen,clock_timestamp());
   return jsonb_build_object('ok',true,'proposal_id',chosen,'already_drawn',false);
 elsif action in ('/api/proposal','/api/remove') then
   w := public.cine_week();
   if (data->>'week') is distinct from w::text then raise exception 'Cette session est fermÃ©e. Actualise la page.'; end if;
   if exists(select 1 from public.cine_draws where week=w) then raise exception 'Le tirage a dÃ©jÃ  eu lieu.'; end if;
   if action='/api/remove' then
     delete from public.cine_proposals where member_id=m and week=w;
   else
     insert into public.cine_proposals(member_id,week,title,year,poster,overview,director,tmdb_id,apple_id,store_url)
     values(m,w,btrim(data->>'title'),coalesce(data->>'year',''),coalesce(data->>'poster',''),coalesce(data->>'overview',''),coalesce(data->>'director',''),(data->>'tmdb_id')::bigint,(data->>'apple_id')::bigint,coalesce(data->>'store_url',''));
   end if;
 elsif action='/api/rating' then
   if jsonb_typeof(data->'seen') is distinct from 'boolean' then raise exception 'Ã‰tat de visionnage invalide.'; end if;
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
 raise exception 'Tu as dÃ©jÃ  proposÃ© un film pour cette session. Retire-le pour en choisir un autre.';
end;
$$;
revoke all on function public.cine_deadline(date),public.cine_week(),public.cine_draw_due(),public.cine_state(),public.cine_mutate(text,jsonb) from public,anon,authenticated;
grant execute on function public.cine_state(),public.cine_mutate(text,jsonb) to anon,authenticated;
commit;

