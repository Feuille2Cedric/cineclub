# Cinéclub

Application séparée de club-33, conçue pour GitHub Pages + Supabase, avec un serveur SQLite pour les essais locaux.

Site : https://feuille2cedric.github.io/cineclub/

Dépôt : https://github.com/Feuille2Cedric/cineclub

- Membres définis dans le code : **Cédric uniquement** pour le moment.
- Une proposition de film par personne et par session, recherche TMDB avec affiches et résumés, ou saisie manuelle.
- Tirage déclenché manuellement par le **profil Cédric (id 1)**, avec le bouton « Lancer le tirage au sort ». Aucun tirage automatique ni limite du dimanche soir.
- Chaque proposition a une chance égale, même si plusieurs membres proposent le même film.
- Une session par semaine, du lundi au dimanche (Europe/Paris). Un tirage clôt ses propositions ; la nouvelle session ouvre le lundi. Les anciennes sessions non tirées restent accessibles à Cédric dans le sélecteur. Aucun report automatique des propositions.
- Notes de 0 à 10, avis, état vu indépendant de la note, moyennes et mur d’affiches filtrable.
- Toutes les propositions peuvent être notées, y compris celles qui ne sont pas tirées au sort.
- Sans proposition, aucun tirage ; la dernière séance reste visible avec sa date.

## Local

```powershell
cd C:\Users\crima\OneDrive\Bureau\DEV\cineclub
python -m pip install -r requirements.txt
python server.py
```

Ouvrir http://localhost:3335, ou utiliser `Lancer.bat` après installation des dépendances.
Les données sont dans `cineclub.sqlite3`, ignoré par Git. Aucun planificateur n’est lancé : le tirage ne se produit qu’après un clic confirmé depuis le profil Cédric.

La recherche TMDB passe par une Edge Function Supabase ; le secret `TMDB_TOKEN` ne quitte jamais Supabase. Un film absent peut être ajouté manuellement.

## Membres

Modifier `members.py` pour le local et la table `cine_members` via SQL pour la version Supabase. Les identifiants doivent rester stables. Aucun ajout de membre depuis l’interface. Pour les membres historiques en ligne, passer `active=false` plutôt que supprimer leurs lignes.

## Mise en ligne

Suivre [SUPABASE.md](SUPABASE.md). Le dossier `static/` est le seul dossier publié sur GitHub Pages. Le workflow vérifie Python, JavaScript et le schéma PostgreSQL avant publication.

Comme club-33, la sélection du profil est libre, sans mot de passe : le profil n’est pas une authentification. Les tables ne sont pas directement modifiables par le navigateur ; les fonctions SQL imposent les règles de proposition et de tirage.

## Vérifications

```powershell
python -m unittest -v
```

Les tests couvrent le contrôle du profil Cédric, l’absence de tirage automatique, les doubles clics, les anciennes sessions, les notes et l’adaptateur Apple. `supabase/test.sql` contrôle les droits et les opérations SQL sur une base de test.

Documentation API : [Apple/iTunes](https://performance-partners.apple.com/search-api).
