import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch
import server


class CineTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.previous = server.DB
        server.DB = Path(self.tmp.name) / 'test.sqlite3'
        server.initialize()
        self.week = '2026-10-05'
        self.close = server.deadline(self.week)

    def tearDown(self):
        server.DB = self.previous
        self.tmp.cleanup()

    def propose(self):
        return server.mutate('/api/proposal',dict(member_id=1,week=self.week,title='Le Voyage',year='2026'),self.close-timedelta(seconds=1))

    def test_one_proposal_and_closed_session(self):
        self.propose()
        with self.assertRaises(server.sqlite3.IntegrityError):self.propose()
        server.mutate('/api/draw',dict(member_id=1,week=self.week),self.close)
        with self.assertRaises(ValueError):
            server.mutate('/api/proposal',dict(member_id=1,week=self.week,title='Trop tard'),self.close)
        with self.assertRaises(ValueError):
            server.mutate('/api/remove',dict(member_id=1,week=self.week),self.close)

    def test_draw_once_even_concurrently(self):
        self.propose()
        with ThreadPoolExecutor(max_workers=6) as pool:
            results=list(pool.map(lambda _:server.mutate('/api/draw',dict(member_id=1,week=self.week),self.close),range(12)))
        self.assertEqual(sum(not r['already_drawn'] for r in results),1)
        with server.connect() as db:
            rows=db.execute('select * from draws').fetchall()
            self.assertEqual(len(rows),1)
            self.assertEqual(rows[0]['proposal_id'],1)

    def test_no_automatic_draw_and_delayed_manual_draw(self):
        self.propose()
        with patch.object(server,'now',return_value=self.close+timedelta(days=15)):
            self.assertEqual(server.snapshot()['draws'],[])
        server.mutate('/api/draw',dict(member_id=1,week=self.week),self.close+timedelta(days=15))
        with server.connect() as db:self.assertEqual(db.execute('select count(*) from draws').fetchone()[0],1)

    def test_only_cedric_can_draw(self):
        self.propose()
        with patch.object(server,'MEMBERS',[(1,'Cédric'),(2,'Test')]):
            server.initialize()
            with self.assertRaisesRegex(ValueError,'Seul Cédric'):
                server.mutate('/api/draw',dict(member_id=2,week=self.week),self.close)

    def test_empty_and_future_draw_rejected(self):
        for week in [self.week,'2026-10-12']:
            with self.assertRaises(ValueError):server.mutate('/api/draw',dict(member_id=1,week=week),self.close)

    def test_paris_dst(self):
        self.assertEqual(server.deadline('2026-03-16').utcoffset(),timedelta(hours=1))
        self.assertEqual(server.deadline('2026-03-23').utcoffset(),timedelta(hours=2))
        self.assertEqual(server.deadline('2026-10-19').utcoffset(),timedelta(hours=1))

    def test_zero_score_seen_and_review_persist(self):
        self.propose()
        data=dict(member_id=1,proposal_id=1,seen=True,score=0,review='Pas convaincu.')
        server.mutate('/api/rating',data,self.close)
        with server.connect() as db:
            row=db.execute('select * from ratings').fetchone()
            self.assertEqual(row['score'],0)
            self.assertEqual(row['review'],'Pas convaincu.')
        data.update(seen=False,score=None)
        server.mutate('/api/rating',data,self.close)
        with server.connect() as db:self.assertIsNone(db.execute('select score from ratings').fetchone()[0])

    def test_invalid_member_score_and_poster(self):
        self.propose()
        for score in (-1,11,True,1.5):
            with self.assertRaises(ValueError):server.mutate('/api/rating',dict(member_id=1,proposal_id=1,seen=True,score=score),self.close)
        with self.assertRaises(ValueError):server.mutate('/api/rating',dict(member_id=2,proposal_id=1,seen=True,score=8),self.close)
        with self.assertRaises(ValueError):server.mutate('/api/rating',dict(member_id=1,proposal_id=1,seen=False,score=8),self.close)

    def test_no_sunday_deadline(self):
        with patch.object(server,'now',return_value=self.close):
            self.assertEqual(server.snapshot()['week'],self.week)
        server.mutate('/api/proposal',dict(member_id=1,week=self.week,title='Encore possible'),self.close+timedelta(seconds=30))

    def test_tmdb_mapping(self):
        from io import BytesIO
        with patch.dict(server.os.environ,{'TMDB_TOKEN':'test'}), patch.object(server,'urlopen',return_value=BytesIO(b'{"results":[{"id":12,"title":"Film","poster_path":"/poster.jpg","release_date":"2001-04-12","overview":"Resume"}]}')):
            film=server.search('Film')['results'][0]
            self.assertEqual(film['year'],'2001')
            self.assertEqual(film['tmdb_id'],12)
            server.mutate('/api/proposal',dict(film,member_id=1,week=self.week),self.close-timedelta(seconds=1))
            with server.connect() as db:
                row=db.execute('select * from proposals').fetchone()
                self.assertEqual(row['tmdb_id'],12)

    def test_external_urls_are_validated(self):
        self.assertFalse(server.trusted_image('https://mzstatic.com.evil.test/a'))
        self.assertFalse(server.trusted_store('javascript:alert(1)'))
        self.assertFalse(server.trusted_store('https://itunes.apple.com.evil.test/a'))
        self.assertTrue(server.trusted_image('https://is1-ssl.mzstatic.com/image/a.jpg'))

if __name__=='__main__':unittest.main()
