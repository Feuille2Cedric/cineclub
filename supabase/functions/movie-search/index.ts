const headers = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'apikey, authorization, content-type','Content-Type':'application/json'};
Deno.serve(async (request: Request) => {
  if(request.method==='OPTIONS') return new Response(null,{headers});
  const query=new URL(request.url).searchParams.get('q')?.trim()||'';
  if(query.length<2||query.length>160) return new Response(JSON.stringify({error:'Saisis au moins deux caractères.'}),{status:400,headers});
  const token=Deno.env.get('TMDB_TOKEN');
  if(!token) return new Response(JSON.stringify({error:'Le secret TMDB_TOKEN est absent de Supabase.'}),{status:503,headers});
  try {
    const response=await fetch('https://api.themoviedb.org/3/search/movie?'+new URLSearchParams({query,language:'fr-FR',include_adult:'false',page:'1'}),{headers:{Authorization:'Bearer '+token,Accept:'application/json'}});
    if(!response.ok) return new Response(JSON.stringify({error:'TMDB ne répond pas correctement.'}),{status:502,headers});
    const payload=await response.json();
    const results=await Promise.all((payload.results||[]).filter((r:{id?:number;title?:string})=>r.id&&r.title).slice(0,15).map(async (r:{id:number;title:string;release_date?:string;overview?:string;poster_path?:string})=>{const d=await fetch('https://api.themoviedb.org/3/movie/'+r.id+'?'+new URLSearchParams({language:'fr-FR',append_to_response:'credits'}),{headers:{Authorization:'Bearer '+token,Accept:'application/json'}}).then(x=>x.json()).catch(()=>({})); const director=(d.credits?.crew||[]).find((c:{job?:string})=>c.job==='Director')?.name||''; return {tmdb_id:r.id,title:r.title,year:(r.release_date||'').slice(0,4),director,overview:(r.overview||'').slice(0,5000),poster:r.poster_path?'https://image.tmdb.org/t/p/w500'+r.poster_path:''};}));
    return new Response(JSON.stringify({results}),{headers});
  } catch { return new Response(JSON.stringify({error:'TMDB est momentanément indisponible.'}),{status:502,headers}); }
});

