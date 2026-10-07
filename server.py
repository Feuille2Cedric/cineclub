import json
import os
import secrets
import sqlite3
import threading
import logging
from datetime import datetime, date, time, timedelta
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs, urlencode
from urllib.request import Request, urlopen
from urllib.error import URLError
import pytz
from members import MEMBERS

ROOT = Path(__file__).resolve().parent
DB = Path(os.environ.get('DATABASE_PATH', str(ROOT / 'cineclub.sqlite3')))
PARIS = pytz.timezone('Europe/Paris')


def now():
    return datetime.now(PARIS)


def monday(moment):
    day = moment.astimezone(PARIS).date()
    return (day - timedelta(days=day.weekday())).isoformat()


def deadline(week):
    return PARIS.localize(datetime.combine(date.fromisoformat(week) + timedelta(days=6), time(23, 59)))


def connect():
    db = sqlite3.connect(str(DB), timeout=20)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    return db


def initialize():
    DB.parent.mkdir(parents=True, exist_ok=True)
    with connect() as db:
        db.executescript('''
        CREATE TABLE IF NOT EXISTS members(id INTEGER PRIMARY KEY, name TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS proposals(
          id INTEGER PRIMARY KEY, member_id INTEGER NOT NULL REFERENCES members(id),
          week TEXT NOT NULL, title TEXT NOT NULL, year TEXT NOT NULL DEFAULT '',
          poster TEXT NOT NULL DEFAULT '', overview TEXT NOT NULL DEFAULT '', tmdb_id INTEGER,
          UNIQUE(member_id, week));
        CREATE TABLE IF NOT EXISTS draws(
          week TEXT PRIMARY KEY, proposal_id INTEGER REFERENCES proposals(id), drawn_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS ratings(
          proposal_id INTEGER NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
          member_id INTEGER NOT NULL REFERENCES members(id), seen INTEGER NOT NULL DEFAULT 0,
          score INTEGER CHECK(score BETWEEN 0 AND 10), review TEXT NOT NULL DEFAULT '',
          PRIMARY KEY(proposal_id,member_id));
        ''')
        db.executemany('INSERT INTO members VALUES (?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name', MEMBERS)


def settle(db, moment):
    # Caller owns an IMMEDIATE transaction: submissions and draws cannot race.
    weeks = db.execute('SELECT DISTINCT week FROM proposals WHERE week NOT IN (SELECT week FROM draws)').fetchall()
    for row in weeks:
        if moment >= deadline(row['week']):
            choices = db.execute('SELECT id FROM proposals WHERE week=? ORDER BY id', (row['week'],)).fetchall()
            chosen = secrets.choice(choices)['id']
            db.execute('INSERT INTO draws VALUES (?,?,?)', (row['week'], chosen, moment.isoformat()))


def draw_due(moment=None):
    with connect() as db:
        db.execute('BEGIN IMMEDIATE')
        settle(db, moment or now())


def snapshot():
    with connect() as db:
        db.execute('BEGIN IMMEDIATE')
        moment = now()
        settle(db, moment)
        week = monday(moment)
        # At Sunday 23:59 the next proposal window opens immediately.
        if moment >= deadline(week):
            week = (date.fromisoformat(week) + timedelta(days=7)).isoformat()
        return dict(members=[dict(id=i, name=n) for i,n in MEMBERS], week=week,
                    deadline=deadline(week).isoformat(), server_time=moment.isoformat(),
                    proposals=[dict(r) for r in db.execute('SELECT * FROM proposals ORDER BY week DESC,id')],
                    draws=[dict(r) for r in db.execute('SELECT * FROM draws ORDER BY week DESC')],
                    ratings=[dict(r) for r in db.execute('SELECT * FROM ratings')],
                    search_available=bool(os.environ.get('TMDB_TOKEN')))


def text_field(data, key, limit, required=False):
    value = data.get(key, '')
    if not isinstance(value, str) or len(value.strip()) > limit or (required and not value.strip()):
        raise ValueError('Champ invalide : ' + key)
    return value.strip()


def mutate(path, data, moment=None):
    member = data.get('member_id')
    if type(member) is not int or member not in {i for i,n in MEMBERS}:
        raise ValueError('Choisis un membre du club.')
    with connect() as db:
        db.execute('BEGIN IMMEDIATE')
        moment = moment or now()
        settle(db, moment)
        if path in ('/api/proposal', '/api/remove'):
            week = monday(moment)
            if moment >= deadline(week):
                week = (date.fromisoformat(week) + timedelta(days=7)).isoformat()
            if data.get('week') != week:
                raise ValueError('Cette session est fermée. Actualise la page.')
            if path == '/api/remove':
                db.execute('DELETE FROM proposals WHERE member_id=? AND week=?', (member, week))
            else:
                title = text_field(data, 'title', 200, True)
                year = text_field(data, 'year', 4)
                if year and (len(year) != 4 or not year.isdigit()):
                    raise ValueError('Année invalide.')
                poster = text_field(data, 'poster', 500)
                if poster and not poster.startswith('https://image.tmdb.org/t/p/'):
                    raise ValueError('Affiche TMDB invalide.')
                overview = text_field(data, 'overview', 5000)
                tmdb_id = data.get('tmdb_id')
                if tmdb_id is not None and (type(tmdb_id) is not int or tmdb_id <= 0):
                    raise ValueError('Film invalide.')
                db.execute('INSERT INTO proposals(member_id,week,title,year,poster,overview,tmdb_id) VALUES (?,?,?,?,?,?,?)',
                           (member,week,title,year,poster,overview,tmdb_id))
        elif path == '/api/rating':
            proposal = data.get('proposal_id')
            if type(proposal) is not int or not db.execute('SELECT 1 FROM proposals WHERE id=?', (proposal,)).fetchone():
                raise ValueError('Film introuvable.')
            score = data.get('score')
            seen = data.get('seen')
            if score is not None and (type(score) is not int or not 0 <= score <= 10):
                raise ValueError('Choisis une note entre 0 et 10.')
            if type(seen) is not bool or (score is not None and not seen):
                raise ValueError('Un film noté doit être marqué vu.')
            review = text_field(data, 'review', 3000)
            db.execute('INSERT INTO ratings VALUES (?,?,?,?,?) ON CONFLICT(proposal_id,member_id) DO UPDATE SET seen=excluded.seen,score=excluded.score,review=excluded.review',
                       (proposal,member,int(seen),score,review))
        else:
            raise ValueError('Action inconnue.')
    return {'ok': True}


def search(query):
    token = os.environ.get('TMDB_TOKEN', '').strip()
    if not token:
        raise ValueError('La recherche TMDB attend sa clé. Tu peux ajouter un film manuellement.')
    url = 'https://api.themoviedb.org/3/search/movie?' + urlencode(dict(query=query, language='fr-FR', include_adult='false'))
    with urlopen(Request(url, headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/json'}), timeout=12) as response:
        payload = json.load(response)
    return {'results': [dict(tmdb_id=r['id'], title=r['title'], year=r.get('release_date','')[:4],
                       overview=r.get('overview',''), poster='https://image.tmdb.org/t/p/w500' + r['poster_path'] if r.get('poster_path') else '')
                       for r in payload.get('results', [])[:15]]}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / 'static'), **kwargs)

    def reply(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        try:
            if parsed.path == '/api/state':
                return self.reply(snapshot())
            if parsed.path == '/api/search':
                query = parse_qs(parsed.query).get('q', [''])[0].strip()
                if not 2 <= len(query) <= 160:
                    raise ValueError('Saisis au moins deux caractères.')
                return self.reply(search(query))
            if parsed.path.startswith('/api/'):
                return self.reply({'error':'Route inconnue.'},404)
            return super().do_GET()
        except ValueError as error:
            self.reply({'error': str(error)},400)
        except (URLError, OSError):
            self.reply({'error':'Le catalogue est indisponible. Réessaie ou ajoute le film manuellement.'},502)

    def do_POST(self):
        try:
            origin = self.headers.get('Origin')
            if origin and urlparse(origin).netloc != self.headers.get('Host'):
                return self.reply({'error':'Origine refusée.'},403)
            length = int(self.headers.get('Content-Length', 0))
            if not 0 < length <= 20000:
                raise ValueError('Requête invalide.')
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise ValueError('Requête invalide.')
            self.reply(mutate(urlparse(self.path).path, data))
        except (ValueError, UnicodeError) as error:
            self.reply({'error':str(error)},400)
        except sqlite3.IntegrityError:
            self.reply({'error':'Tu as déjà proposé un film pour cette session. Retire-le pour en choisir un autre.'},409)


def scheduler():
    while True:
        try:
            draw_due()
        except Exception:
            logging.exception('Tirage différé : nouvelle tentative dans une seconde')
        threading.Event().wait(1)


if __name__ == '__main__':
    initialize()
    threading.Thread(target=scheduler, daemon=True).start()
    port = int(os.environ.get('PORT','3335'))
    print('Cinéclub : http://localhost:%s' % port, flush=True)
    ThreadingHTTPServer((os.environ.get('HOST','127.0.0.1'), port), Handler).serve_forever()
