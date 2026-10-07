import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from urllib.request import urlopen
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as tmp:
    env = dict(os.environ, PORT='3336', DATABASE_PATH=str(Path(tmp)/'browser.sqlite3'))
    server = subprocess.Popen([os.environ.get('CINE_TEST_PYTHON', sys.executable),'server.py'],cwd=str(ROOT),env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            try:
                urlopen('http://127.0.0.1:3336/api/state').close()
                break
            except OSError:time.sleep(.2)
        with sync_playwright() as p:
            browser=p.chromium.launch(channel=os.environ.get('CINE_BROWSER_CHANNEL','msedge'),headless=True)
            page=browser.new_page(viewport={'width':1440,'height':1000})
            errors=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto('http://127.0.0.1:3336')
            page.get_by_role('button',name='Cédric',exact=False).click()
            page.get_by_role('button',name='+ Proposer un film').click()
            page.locator('#manual summary').click()
            page.locator('[name=title]').fill('Le Voyage')
            page.locator('[name=year]').fill('2026')
            page.get_by_role('button',name='Proposer ce film',exact=True).click()
            page.locator('#proposal-dialog').wait_for(state='hidden')
            page.get_by_role('button',name='Voir et noter',exact=True).click()
            page.locator('[name=score]').select_option('0')
            page.locator('[name=review]').fill('Un avis enregistré pour le test.')
            page.get_by_role('button',name='Enregistrer mon avis').click()
            page.locator('#film-dialog').wait_for(state='hidden')
            page.reload()
            page.get_by_role('link',name='Affiches',exact=True).click()
            page.locator('.tile').wait_for()
            assert 'Noté · 0/10' in page.locator('.tile').inner_text()
            page.locator('#filter').select_option('unseen')
            assert page.locator('.tile').count()==0
            page.locator('#filter').select_option('rated')
            page.locator('.tile').click()
            assert page.locator('[name=review]').input_value()=='Un avis enregistré pour le test.'
            page.locator('[name=seen]').uncheck()
            page.get_by_role('button',name='Enregistrer mon avis').click()
            page.locator('#film-dialog').wait_for(state='hidden')
            page.locator('#filter').select_option('unseen')
            page.locator('.tile.unseen').wait_for()
            page.locator('.tile').click()
            page.locator('[name=seen]').check()
            page.get_by_role('button',name='Enregistrer mon avis').click()
            page.locator('#film-dialog').wait_for(state='hidden')
            page.locator('#filter').select_option('seen')
            page.locator('.tile').wait_for()
            page.get_by_role('link',name='Cette semaine',exact=True).click()
            page.get_by_role('button',name='Retirer',exact=True).click()
            page.get_by_role('button',name='+ Proposer un film').wait_for(state='visible')
            # Contract fixture: an Apple response, without requiring a real key.
            def apple_fixture(route):
                from urllib.parse import urlparse, parse_qs
                callback=parse_qs(urlparse(route.request.url).query)['callback'][0]
                route.fulfill(content_type='text/javascript',body=callback+'('+json.dumps({'results':[{'kind':'feature-movie','trackId':123,'trackName':'Film du catalogue','releaseDate':'2001-01-01','trackViewUrl':'https://itunes.apple.com/fr/movie/id123'}]})+');')
            page.route('https://itunes.apple.com/search?*',apple_fixture)
            page.get_by_role('button',name='+ Proposer un film').click()
            page.locator('#search').fill('Film')
            page.locator('.result').click()
            page.get_by_role('button',name='Proposer ce film',exact=True).click()
            page.locator('#proposal-dialog').wait_for(state='hidden')
            page.locator('.card h3').wait_for()
            assert page.locator('.card h3').inner_text()=='Film du catalogue'
            artifacts=ROOT/'test-artifacts';artifacts.mkdir(exist_ok=True)
            page.screenshot(path=str(artifacts/'desktop.png'),full_page=True)
            page.set_viewport_size({'width':390,'height':844})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.screenshot(path=str(artifacts/'mobile.png'),full_page=True)
            page.on('dialog',lambda dialog:dialog.accept())
            page.get_by_role('button',name='Lancer le tirage au sort',exact=True).click()
            page.locator('#film-dialog').wait_for(state='visible')
            page.locator('#film-dialog [data-close]').click()
            page.locator('#winner .feature').wait_for()
            assert page.get_by_role('button',name='Les propositions sont closes').is_disabled()
            assert page.locator('[data-remove]').count()==0
            page.reload()
            page.locator('#winner .feature').wait_for()
            assert page.get_by_role('button',name='Lancer le tirage au sort',exact=True).is_disabled()
            assert errors==[],errors
            browser.close()
            print('Browser OK: proposal, search fixture, rating 0, review persistence, seen filters, deletion, desktop/mobile; no JS errors.')
    finally:
        server.terminate()
        server.wait(timeout=10)
