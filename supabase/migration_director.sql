alter table public.cine_proposals add column if not exists director text not null default '' check(length(director)<=200);
