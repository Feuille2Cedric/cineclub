import json
import os
import secrets
import sqlite3
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
        columns = {r['name'] for r in db.execute('PRAGMA table_info(proposals)')}
        if 'apple_id' not in columns:
            db.execute('ALTER TABLE proposals ADD COLUMN apple_id INTEGER')
        if 'store_url' not in columns:
            db.execute("ALTER TABLE proposals ADD COLUMN store_url TEXT NOT NULL DEFAULT ''")
        db.executemany('INSERT INTO members VALUES (?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name', MEMBERS)


def snapshot():
    with connect() as db:
        db.execute('BEGIN IMMEDIATE')
        moment = now()
        week = monday(moment)
        return dict(members=[dict(r) for r in db.execute('SELECT id,name FROM members ORDER BY id')], week=week,
                    draw_admin_id=1, server_time=moment.isoformat(),
                    proposals=[dict(r) for r in db.execute('SELECT * FROM proposals ORDER BY week DESC,id')],
                    draws=[dict(r) for r in db.execute('SELECT * FROM draws ORDER BY week DESC')],
                    ratings=[dict(r) for r in db.execute('SELECT * FROM ratings')],
                    search_available=True)


def text_field(data, key, limit, required=False):
    value = data.get(key, '')
    if not isinstance(value, str) or len(value.strip()) > limit or (required and not value.strip()):
        raise ValueError('Champ invalide : ' + key)
    return value.strip()


def mutate(path, data, moment=None):
    if path == '/api/member':
        name = text_field(data, 'name', 40, True)
        with connect() as db:
            if db.execute('SELECT 1 FROM members WHERE lower(trim(name))=lower(trim(?))', (name,)).fetchone():
                raise ValueError('Ce prénom existe déjà.')
            cursor = db.execute('INSERT INTO members(name) VALUES (?)', (name,))
            return {'ok': True, 'member': {'id': cursor.lastrowid, 'name': name}}
    member = data.get('member_id')
    if type(member) is not int or member not in {i for i,n in MEMBERS}:
        raise ValueError('Choisis un membre du club.')
    with connect() as db:
        db.execute('BEGIN IMMEDIATE')
        moment = moment or now()
        if path == '/api/draw':
            if member != 1:
                raise ValueError('Seul Cédric peut lancer le tirage.')
            week = text_field(data, 'week', 10, True)
            parsed = date.fromisoformat(week)
            if parsed.isoformat() != week or parsed.weekday() != 0 or week > monday(moment):
                raise ValueError('Session invalide.')
            existing = db.execute('SELECT proposal_id FROM draws WHERE week=?', (week,)).fetchone()
            if existing:
                return {'ok': True, 'proposal_id': existing['proposal_id'], 'already_drawn': True}
            choices = db.execute('SELECT id FROM proposals WHERE week=? ORDER BY id', (week,)).fetchall()
            if not choices:
                raise ValueError('Il faut au moins une proposition pour lancer le tirage.')
            chosen = secrets.choice(choices)['id']
            db.execute('INSERT INTO draws VALUES (?,?,?)', (week, chosen, moment.isoformat()))
            return {'ok': True, 'proposal_id': chosen, 'already_drawn': False}
        elif path in ('/api/proposal', '/api/remove'):
            week = monday(moment)
            if data.get('week') != week:
                raise ValueError('Cette session est fermée. Actualise la page.')
            if db.execute('SELECT 1 FROM draws WHERE week=?', (week,)).fetchone():
                raise ValueError('Le tirage a déjà eu lieu. Les propositions sont closes pour cette semaine.')
            if path == '/api/remove':
                db.execute('DELETE FROM proposals WHERE member_id=? AND week=?', (member, week))
            else:
                title = text_field(data, 'title', 200, True)
                year = text_field(data, 'year', 4)
                if year and (len(year) != 4 or not year.isdigit()):
                    raise ValueError('Année invalide.')
                poster = text_field(data, 'poster', 500)
                if poster and not trusted_image(poster):
                    raise ValueError('Affiche invalide.')
                overview = text_field(data, 'overview', 5000)
                tmdb_id = data.get('tmdb_id')
                if tmdb_id is not None and (type(tmdb_id) is not int or tmdb_id <= 0):
                    raise ValueError('Film invalide.')
                apple_id = data.get('apple_id')
                if apple_id is not None and (type(apple_id) is not int or apple_id <= 0):
                    raise ValueError('Film Apple invalide.')
                store_url = text_field(data, 'store_url', 2000)
                if store_url and not trusted_store(store_url):
                    raise ValueError('Lien Apple invalide.')
                db.execute('INSERT INTO proposals(member_id,week,title,year,poster,overview,tmdb_id,apple_id,store_url) VALUES (?,?,?,?,?,?,?,?,?)',
                           (member,week,title,year,poster,overview,tmdb_id,apple_id,store_url))
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


def trusted_image(value):
    u = urlparse(value)
    return u.scheme == 'https' and (u.hostname == 'image.tmdb.org' or (u.hostname or '').endswith('.mzstatic.com') or u.hostname == 'mzstatic.com')


def trusted_store(value):
    u = urlparse(value)
    return u.scheme == 'https' and u.hostname in ('itunes.apple.com', 'tv.apple.com')


def search(query):
    url = 'https://itunes.apple.com/search?' + urlencode(dict(term=query, country='fr', limit=50))
    with urlopen(Request(url, headers={'Accept': 'application/json'}), timeout=15) as response:
        payload = json.load(response)
    return {'results': [dict(apple_id=r['trackId'], title=r['trackName'], year=r.get('releaseDate','')[:4],
                       overview=(r.get('longDescription') or r.get('shortDescription') or '')[:5000],
                       poster=r.get('artworkUrl100','').replace('/100x100bb.', '/600x600bb.') if trusted_image(r.get('artworkUrl100','')) else '',
                       store_url=r.get('trackViewUrl','') if trusted_store(r.get('trackViewUrl','')) else '')
                       for r in payload.get('results', []) if r.get('kind') == 'feature-movie' and r.get('trackName') and type(r.get('trackId')) is int][:15]}


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


if __name__ == '__main__':
    initialize()
    port = int(os.environ.get('PORT','3335'))
    print('Cinéclub : http://localhost:%s' % port, flush=True)
    ThreadingHTTPServer((os.environ.get('HOST','127.0.0.1'), port), Handler).serve_forever()
