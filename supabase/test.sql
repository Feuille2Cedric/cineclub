begin;
-- No data survives this test transaction.
do $$ begin
 if has_table_privilege('anon','public.cine_proposals','INSERT') then raise exception 'Direct write exposed'; end if;
 if has_function_privilege('anon','public.cine_draw_due()','EXECUTE') then raise exception 'Private draw exposed'; end if;
end $$;
set local role anon;
select public.cine_mutate('/api/proposal',jsonb_build_object('member_id',1,'week',public.cine_state()->>'week','title','Test film'));
do $$ begin
 begin
   perform public.cine_mutate('/api/proposal',jsonb_build_object('member_id',1,'week',public.cine_state()->>'week','title','Duplicate'));
   raise exception 'Duplicate accepted';
 exception when raise_exception then
   if SQLERRM='Duplicate accepted' then raise; end if;
 end;
end $$;
select public.cine_mutate('/api/rating',jsonb_build_object('member_id',1,'proposal_id',(public.cine_state()->'proposals'->0->>'id')::bigint,'seen',true,'score',0,'review','Persisted review'));
do $$ begin
 if (public.cine_state()->'ratings'->0->>'score')::int<>0 then raise exception 'Zero rating lost'; end if;
end $$;
reset role;
insert into public.cine_proposals(member_id,week,title) values (1,'2020-01-06','Past film');
select public.cine_draw_due();
select public.cine_draw_due();
do $$ begin
 if (select count(*) from public.cine_draws where week='2020-01-06')<>1 then raise exception 'Draw not idempotent'; end if;
 if public.cine_deadline('2026-03-23')<>timestamptz '2026-03-29 21:59:00+00' then raise exception 'Summer timezone invalid'; end if;
 if public.cine_deadline('2026-10-19')<>timestamptz '2026-10-25 22:59:00+00' then raise exception 'Winter timezone invalid'; end if;
end $$;
rollback;
