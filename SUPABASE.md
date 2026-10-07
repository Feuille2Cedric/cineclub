# GitHub Pages + Supabase

Les tables `cine_members`, `cine_proposals`, `cine_draws`, `cine_ratings` sont indépendantes des tables `club_*`. Il est possible d’utiliser le même projet Supabase que club-33. Aucun script de ce dossier ne modifie ses tables.

## 1. Base et tirage

1. Dans Supabase > SQL Editor, exécuter [supabase/schema.sql](supabase/schema.sql).
2. Recharger le site et choisir Cédric : le bouton « Lancer le tirage au sort » apparaît. Il devient disponible dès qu’une session contient des propositions.

**Aucun cron à activer.** Le tirage est manuel et réservé au profil d’identifiant 1 (Cédric), vérifié côté SQL. Le résultat est persistant, sans possibilité de relancer une même session. Le verrou SQL empêche un double tirage et les modifications concurrentes des propositions.

Si l’ancienne version était installée, réexécuter `schema.sql` : il conserve les données, supprime le job `cineclub-weekly-draw` s’il existe et neutralise l’ancienne fonction automatique. Il ne touche pas aux autres tâches Cron. La sélection des profils reste libre, sans authentification, comme dans club-33.

## 2. Recherche Apple/iTunes

Aucune configuration nécessaire : la recherche interroge Apple depuis le navigateur, sans clé API et sans Edge Function. L’ajout manuel reste disponible pour les films absents du catalogue français.

Si le premier schéma TMDB avait déjà été installé, réexécuter `supabase/schema.sql` : il ajoute `apple_id` et `store_url`, accepte les affiches Apple et met à jour la fonction de proposition. Les anciennes propositions et notes sont conservées. La fonction `movie-search` et le secret `TMDB_TOKEN` ne sont plus utilisés par l’application.

## 3. Dépôt et Pages

Créer un dépôt GitHub pour ce dossier, puis configurer :

- Settings > Pages > Source : **GitHub Actions**.
- Settings > Secrets and variables > Actions > **Variables** : `SUPABASE_URL` et `SUPABASE_PUBLISHABLE_KEY`.
- Utiliser une clé `sb_publishable_...` ou l’ancienne clé `anon`, jamais `service_role` ni `sb_secret_...`.

Le workflow `.github/workflows/pages.yml` injecte ces deux valeurs publiques dans `static/config.js` et publie `static/` à chaque push sur `main`. Il ne déploie pas automatiquement le schéma SQL.

## Ajouter les prochains membres

Exécuter une instruction explicite en SQL, par exemple :

```sql
insert into public.cine_members(id,name) values (2,'Prénom');
```

Ajouter le même identifiant dans `members.py` si l’on souhaite aussi le retrouver dans les essais locaux. Ne pas réattribuer les identifiants existants.

## Vérification après installation

Choisir Cédric, proposer un film, lancer le tirage et vérifier que le résultat reste identique après rechargement. Les autres profils ne doivent pas avoir le bouton. Ne pas exécuter `supabase/test.sql` sur des données réelles : il est destiné à une base de test.
