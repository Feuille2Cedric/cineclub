async function api(path, body, signal) {
  const cfg = window.CINECLUB_CONFIG || {};
  let target = path, payload = body, headers = {'Content-Type':'application/json'};
  if (cfg.supabaseUrl && cfg.supabaseKey) {
    const root = cfg.supabaseUrl.trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
    headers.apikey = cfg.supabaseKey;
    if (cfg.supabaseKey.startsWith('eyJ')) headers.Authorization = 'Bearer ' + cfg.supabaseKey;
    if (path.startsWith('/api/search?')) {
      target = root + '/functions/v1/movie-search' + path.slice(path.indexOf('?'));
    } else {
      target = root + '/rest/v1/rpc/' + (body ? 'cine_mutate' : 'cine_state');
      payload = body ? {action:path, data:body} : {};
    }
  } else if (location.hostname.endsWith('.github.io')) {
    throw new Error('La base du club reste à connecter. Consulte le guide SUPABASE.md.');
  }
  const response = await fetch(target, {method:payload ? 'POST':'GET', headers,
    body:payload ? JSON.stringify(payload):undefined, signal, cache:'no-store'});
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Le serveur ne répond pas. Lance l’application avec Lancer.bat.');
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || result.message || 'Impossible d’enregistrer. Réessaie.');
  return result;
}
