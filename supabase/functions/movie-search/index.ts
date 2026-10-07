// Le jeton TMDB reste dans les secrets de la fonction, jamais dans GitHub Pages.
const headers = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'apikey, authorization, content-type', 'Content-Type':'application/json'};
const cache = new Map<string, {at:number; data:unknown}>();
Deno.serve(async (request:Request) => {
  if(request.method==='OPTIONS')return new Response(null,{headers});
  const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
  if(request.method!=='GET')return reply({error:'Méthode non autorisée.'},405);
  const query=new URL(request.url).searchParams.get('q')?.trim()||'';
  if(query.length<2||query.length>160)return reply({error:'Saisis entre 2 et 160 caractères.'},400);
  const token=Deno.env.get('TMDB_TOKEN');
  if(!token)return reply({error:'La recherche attend sa clé TMDB. Tu peux ajouter un film manuellement.'},503);
  const key=query.toLocaleLowerCase('fr');const existing=cache.get(key);
  if(existing&&Date.now()-existing.at<600000)return reply(existing.data);
  try{
    const response=await fetch('https://api.themoviedb.org/3/search/movie?'+new URLSearchParams({query,language:'fr-FR',include_adult:'false'}),{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(12000)});
    if(!response.ok)return reply({error:'Le catalogue est indisponible. Réessaie dans un instant.'},502);
    const result=await response.json();
    const data={results:(result.results||[]).slice(0,15).map((film:{id:number; title:string; release_date?:string; overview?:string; poster_path?:string})=>({tmdb_id:film.id,title:film.title,year:(film.release_date||'').slice(0,4),overview:film.overview||'',poster:film.poster_path?'https://image.tmdb.org/t/p/w500'+film.poster_path:''}))};
    if(cache.size>=200)cache.clear();cache.set(key,{at:Date.now(),data});return reply(data);
  }catch{return reply({error:'Le catalogue met trop de temps à répondre. Réessaie.'},502);}
});
