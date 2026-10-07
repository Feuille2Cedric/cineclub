async function api(path, body, signal) {
  if (path.startsWith('/api/search?')) return appleSearch(new URL(path, location.origin).searchParams.get('q'), signal);
  const cfg = window.CINECLUB_CONFIG || {};
  let target = path, payload = body, headers = {'Content-Type':'application/json'};
  if (cfg.supabaseUrl && cfg.supabaseKey) {
    const root = cfg.supabaseUrl.trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
    headers.apikey = cfg.supabaseKey;
    if (cfg.supabaseKey.startsWith('eyJ')) headers.Authorization = 'Bearer ' + cfg.supabaseKey;
    target = root + '/rest/v1/rpc/' + (body ? 'cine_mutate' : 'cine_state');
    payload = body ? {action:path, data:body} : {};
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

function trustedImage(value) {
  try { const u=new URL(value); return u.protocol==='https:' && (u.hostname==='image.tmdb.org' || /(^|\.)mzstatic\.com$/.test(u.hostname)); } catch { return false; }
}
function trustedStore(value) {
  try { const u=new URL(value); return u.protocol==='https:' && ['itunes.apple.com','tv.apple.com'].includes(u.hostname); } catch { return false; }
}
const appleCache=new Map();
let appleRequestId=0;
function appleSearch(query, signal) {
  if(signal?.aborted)return Promise.reject(new DOMException('Annulé','AbortError'));
  query=(query||'').trim();
  if(query.length<2)return Promise.resolve({results:[]});
  const key=query.toLocaleLowerCase('fr'), cached=appleCache.get(key);
  if(cached && Date.now()-cached.at<600000)return Promise.resolve(cached.data);
  return new Promise((resolve,reject)=>{
    const callback='cineApple'+(++appleRequestId), script=document.createElement('script');
    let timeout;
    function clean(){clearTimeout(timeout);script.remove();signal?.removeEventListener('abort',abort);window[callback]=()=>{};setTimeout(()=>delete window[callback],60000);}
    function abort(){clean();reject(new DOMException('Annulé','AbortError'));}
    window[callback]=payload=>{
      clean();
      if(!Array.isArray(payload?.results)){reject(new Error('Le catalogue Apple est indisponible. Utilise l’ajout manuel ou réessaie.'));return;}
      const data={results:payload.results.filter(r=>r?.kind==='feature-movie'&&r.trackName&&Number.isSafeInteger(r.trackId)).slice(0,15).map(r=>({
        apple_id:r.trackId,title:r.trackName,year:(r.releaseDate||'').slice(0,4),overview:(r.longDescription||r.shortDescription||'').slice(0,5000),
        poster:trustedImage(r.artworkUrl100)?r.artworkUrl100.replace('/100x100bb.', '/600x600bb.'):'',store_url:trustedStore(r.trackViewUrl)?r.trackViewUrl:''
      }))};
      if(appleCache.size>=100)appleCache.clear();appleCache.set(key,{at:Date.now(),data});resolve(data);
    };
    script.onerror=()=>{clean();reject(new Error('Recherche Apple indisponible. Réessaie ou ajoute le film manuellement.'));};
    timeout=setTimeout(()=>{clean();reject(new Error('Apple met trop de temps à répondre. Réessaie ou utilise l’ajout manuel.'));},15000);
    signal?.addEventListener('abort',abort,{once:true});
    // Apple currently returns empty results with media=movie/entity=movie.
    // Search the storefront, then retain feature films only.
    script.src='https://itunes.apple.com/search?'+new URLSearchParams({term:query,country:'fr',limit:'50',callback});
    document.head.append(script);
  });
}
