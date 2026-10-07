# Cinéclub

Application séparée de club-33, conçue pour GitHub Pages + Supabase, avec un serveur SQLite pour les essais locaux.

Site : https://feuille2cedric.github.io/cineclub/

Dépôt : https://github.com/Feuille2Cedric/cineclub

- Membres définis dans le code : **Cédric uniquement** pour le moment.
- Une proposition de film par personne et par session, recherche Apple/iTunes avec affiches et résumés disponibles, ou saisie manuelle.
- Tirage dimanche à **23 h 59, Europe/Paris**. La proposition gagnante devient le film de la semaine suivante.
- Chaque proposition a une chance égale, même si plusieurs membres proposent le même film.
- La session suivante ouvre dès le tirage. Les propositions perdantes restent dans l’historique, sans report automatique.
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
Les données sont dans `cineclub.sqlite3`, ignoré par Git. Le serveur local doit rester lancé pour tirer à l’heure ; après interruption, il rattrape les tirages manqués au redémarrage. En ligne, le cron Supabase fonctionne sans navigateur ouvert.

La recherche Apple/iTunes fonctionne sans clé ni compte, directement dans le navigateur, y compris sur GitHub Pages. Elle interroge le catalogue français ; un film absent peut être ajouté manuellement. Les résultats sont mis en cache pendant dix minutes. Un lien « Voir sur Apple » accompagne les films du catalogue.

## Membres

Modifier `members.py` pour le local et la table `cine_members` via SQL pour la version Supabase. Les identifiants doivent rester stables. Aucun ajout de membre depuis l’interface. Pour les membres historiques en ligne, passer `active=false` plutôt que supprimer leurs lignes.

## Mise en ligne

Suivre [SUPABASE.md](SUPABASE.md). Le dossier `static/` est le seul dossier publié sur GitHub Pages. Le workflow vérifie Python, JavaScript et le schéma PostgreSQL avant publication.

Comme club-33, la sélection du profil est libre, sans mot de passe : le profil n’est pas une authentification. Les tables ne sont pas directement modifiables par le navigateur ; les fonctions SQL imposent les règles de proposition et de tirage.

## Vérifications

```powershell
python -m unittest -v
```

Les tests couvrent les échéances, l’heure d’été/hiver, la concurrence des tirages, les notes et l’adaptateur Apple. `supabase/test.sql` contrôle les droits et les opérations SQL sur une base de test.

Documentation API : [Apple/iTunes](https://performance-partners.apple.com/search-api), [Supabase Cron](https://supabase.com/docs/guides/cron).
