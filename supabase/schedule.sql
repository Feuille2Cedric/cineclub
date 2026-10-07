-- Activer Cron dans Supabase > Integrations > Cron, puis exécuter ce fichier.
-- Contrôle chaque minute ; l'échéance est calculée en Europe/Paris dans le SQL.
-- Les changements d'heure été/hiver n'exigent donc aucune modification du cron.
select cron.schedule('cineclub-weekly-draw','* * * * *','select public.cine_draw_due()');
