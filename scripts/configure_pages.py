import json
import os
from pathlib import Path

url = os.environ.get('SUPABASE_URL', '').strip().rstrip('/')
key = os.environ.get('SUPABASE_PUBLISHABLE_KEY', '').strip()
if not url.startswith('https://') or not key:
    raise SystemExit('Configurer SUPABASE_URL et SUPABASE_PUBLISHABLE_KEY dans les variables GitHub Actions.')
if key.startswith('sb_secret_'):
    raise SystemExit('La clé privée ne doit jamais être publiée.')
if key.startswith('eyJ'):
    import base64
    try:
        payload = key.split('.')[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
    except (ValueError, IndexError):
        raise SystemExit('Clé JWT invalide.')
    if claims.get('role') != 'anon':
        raise SystemExit('Utiliser uniquement une clé anon ou publishable.')
elif not key.startswith('sb_publishable_'):
    raise SystemExit('Clé publique Supabase non reconnue.')
target = Path(__file__).resolve().parents[1] / 'static' / 'config.js'
target.write_text('window.CINECLUB_CONFIG = ' + json.dumps(dict(supabaseUrl=url,supabaseKey=key)) + ';\n', encoding='utf-8')
