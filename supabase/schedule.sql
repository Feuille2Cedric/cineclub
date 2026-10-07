-- Le tirage est désormais manuel : aucun cron à créer.
-- Exécuter schema.sql pour installer toute la mise à jour.
-- Ce fichier désactive uniquement l'ancien job du cinéclub, s'il existe.
do $$ declare job bigint; begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
   for job in execute 'select jobid from cron.job where jobname=''cineclub-weekly-draw''' loop
     execute 'select cron.unschedule($1)' using job;
   end loop;
 end if;
end $$;
