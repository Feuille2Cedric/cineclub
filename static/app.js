const $ = s => document.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state, member, selectedFilm, activeFilm, searchTimer, searchController, searchVersion=0, loading=false;
try {member=Number(localStorage.getItem('cineclub.member'));} catch {}
const name = id => state.members.find(m=>m.id===id)?.name || 'Ancien membre';
const mine = id => state.ratings.find(r=>r.proposal_id===id && r.member_id===member);
const status = id => mine(id)?.score != null ? 'Noté · '+mine(id).score+'/10' : mine(id)?.seen ? 'Vu · à noter':'À voir';
const picture = film => trustedImage(film.poster) ? `<img src="${esc(film.poster)}" alt="Affiche de ${esc(film.title)}" loading="lazy">`:`<span class="placeholder">${esc(film.title)}</span>`;
const pretty = value => new Date(value+'T12:00:00').toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'});
const following = week => {const d=new Date(week+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+7);return d.toISOString().slice(0,10);};
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;setTimeout(()=>$('#toast').hidden=true,3500);}
const storeLink = film => trustedStore(film.store_url) ? `<a class="store-link" href="${esc(film.store_url)}" target="_blank" rel="noopener">Voir sur Apple</a>` : '';
function card(film){
  const scores=state.ratings.filter(r=>r.proposal_id===film.id && r.score!=null);
  const average=scores.length?(scores.reduce((n,r)=>n+r.score,0)/scores.length).toLocaleString('fr-FR',{maximumFractionDigits:1})+'/10':'Aucune note';
  return `<article class="card"><div class="card-top"><span><span class="avatar">${esc(name(film.member_id)[0])}</span>${esc(name(film.member_id))}</span><span>${esc(film.year)}</span></div><button class="poster" data-film="${film.id}" aria-label="Voir et noter ${esc(film.title)}">${picture(film)}</button><div class="card-body"><h3>${esc(film.title)}</h3>${storeLink(film)}<p>${status(film.id)}</p><button data-film="${film.id}">Voir et noter</button></div><div class="card-bottom"><span>${average} · ${scores.length} avis</span>${film.member_id===member&&film.week===state.week?`<button class="remove" data-remove="${film.id}">Retirer</button>`:''}</div></article>`;
}
function feature(draw){
  const film=state.proposals.find(f=>f.id===draw.proposal_id);
  if(!film)return '';
  return `<article class="feature"><div class="poster">${picture(film)}</div><div class="copy"><span class="eyebrow">LE FILM DU CLUB · SEMAINE DU ${esc(pretty(following(draw.week)))}</span><h2>${esc(film.title)}</h2>${storeLink(film)}<p>${esc(film.year)} · Proposé par ${esc(name(film.member_id))}<br>${status(film.id)}</p><button class="primary" data-film="${film.id}">Voir et noter le film</button></div></article>`;
}
function renderWall(){
  const filter=$('#filter').value, query=$('#wall-search').value.trim().toLocaleLowerCase('fr');
  const films=state.proposals.filter(f=>{
    const r=mine(f.id);return f.title.toLocaleLowerCase('fr').includes(query)&&(filter==='all'||filter==='unseen'&&!r?.seen||filter==='seen'&&r?.seen&&r.score==null||filter==='rated'&&r?.score!=null||filter==='selected'&&state.draws.some(d=>d.proposal_id===f.id));
  });
  $('#stats').textContent=films.length+' film'+(films.length>1?'s':'');
  $('#wall').innerHTML=films.length?films.map(f=>`<button class="tile ${mine(f.id)?.seen?'':'unseen'}" data-film="${f.id}"><div class="poster">${picture(f)}<span class="badge">${status(f.id)}</span></div><h3>${esc(f.title)}</h3><small>${esc(name(f.member_id))} · ${esc(f.year)}</small></button>`).join(''):'<p class="empty">Aucun film dans cette sélection.</p>';
}
function render(){
  const chosen=state.members.find(m=>m.id===member);
  $('#welcome').hidden=!!chosen;$('#club').hidden=!chosen;$('#profile').hidden=!chosen;
  $('#members').innerHTML=state.members.map(m=>`<button data-member="${m.id}"><span class="avatar">${esc(m.name[0])}</span>${esc(m.name)}</button>`).join('');
  if(!chosen)return;
  $('#profile').textContent=chosen.name+' · changer';
  const route=['week','history','posters'].includes(location.hash.slice(1))?location.hash.slice(1):'week';
  for(const view of ['week','history','posters'])$(`#${view}-view`).hidden=route!==view;
  document.querySelectorAll('nav a').forEach(a=>{a.removeAttribute('aria-current');if(a.hash==='#'+route)a.setAttribute('aria-current','page');});
  const proposals=state.proposals.filter(p=>p.week===state.week);
  $('#propose').disabled=proposals.some(p=>p.member_id===member);
  $('#propose').textContent=$('#propose').disabled?'Ta proposition est enregistrée':'+ Proposer un film';
  $('#deadline').textContent='Tirage le '+new Date(state.deadline).toLocaleString('fr-FR',{timeZone:'Europe/Paris',weekday:'long',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'})+' · heure de Paris';
  $('#progress').textContent=proposals.length+' / '+state.members.length+' propositions';
  $('#winner').innerHTML=state.draws.length?feature(state.draws[0]):'<div class="empty"><h3>La première séance se prépare</h3><p>Propose ton film : le premier tirage désignera celui que le club regardera.</p></div>';
  $('#proposals').innerHTML=proposals.map(card).join('')+state.members.filter(m=>!proposals.some(p=>p.member_id===m.id)).map(m=>`<article class="empty"><h3>${esc(m.name)}</h3><p>${m.id===member?'À toi de proposer la prochaine découverte.':'Sa proposition arrive bientôt.'}</p></article>`).join('');
  $('#history').innerHTML=state.draws.length?state.draws.map(d=>`<section class="archive">${feature(d)}<details><summary>Les propositions du ${esc(pretty(d.week))}</summary><div class="grid">${state.proposals.filter(p=>p.week===d.week).map(card).join('')}</div></details></section>`).join(''):'<div class="empty">Les séances apparaîtront ici après le premier tirage.</div>';
  renderWall();
}
async function refresh(){
  if(loading)return;loading=true;
  try{state=await api('/api/state');$('#error').hidden=true;render();}
  catch(e){$('#error').textContent=e.message;$('#error').hidden=false;if(!state)$('#members').innerHTML='<button id="retry">Réessayer</button>';}
  finally{loading=false;}
}
function openFilm(id){
  activeFilm=state.proposals.find(f=>f.id===id);if(!activeFilm)return;
  const r=mine(id),form=$('#rating-form');
  $('#film-details').innerHTML=`<h2>${esc(activeFilm.title)}</h2><p>${esc(activeFilm.year)} · Proposé par ${esc(name(activeFilm.member_id))}</p>${activeFilm.overview?`<p>${esc(activeFilm.overview)}</p>`:''}${trustedStore(activeFilm.store_url)?`<p>${storeLink(activeFilm)}</p>`:''}`;
  form.elements.seen.checked=!!r?.seen;form.elements.score.value=r?.score??'';form.elements.review.value=r?.review||'';form.querySelector('.form-error').textContent='';
  $('#reviews').innerHTML='<h3>Les avis du club</h3>'+state.ratings.filter(v=>v.proposal_id===id&&(v.score!=null||v.review)).map(v=>`<div class="review"><strong>${esc(name(v.member_id))}</strong> · ${v.score!=null?v.score+'/10':'Sans note'}<p>${esc(v.review)}</p></div>`).join('');
  if(!$('#film-dialog').open)$('#film-dialog').showModal();
}
document.addEventListener('click',async event=>{
  const b=event.target.closest('button');if(!b)return;
  if(b.hasAttribute('data-close')){b.closest('dialog').close();return;}
  if(b.dataset.member){member=Number(b.dataset.member);try{localStorage.setItem('cineclub.member',member);}catch{}render();}
  if(b.dataset.film)openFilm(Number(b.dataset.film));
  if(b.id==='retry')refresh();
  if(b.dataset.remove){
    b.disabled=true;
    try{await api('/api/remove',{member_id:member,week:state.week});await refresh();toast('Proposition retirée.');}
    catch(e){toast(e.message);}finally{b.disabled=false;}
  }
});
$('#profile').onclick=()=>{member=null;try{localStorage.removeItem('cineclub.member');}catch{}render();};
$('#propose').onclick=()=>{selectedFilm=null;$('#proposal-form').reset();$('#selection').textContent='';$('#results').innerHTML='';$('#proposal-form .form-error').textContent='';$('#search-status').textContent='';$('#proposal-dialog').showModal();$('#search').focus();};
$('#proposal-dialog').addEventListener('close',()=>{searchController?.abort();clearTimeout(searchTimer);searchVersion++;});
$('#search').addEventListener('input',()=>{
  clearTimeout(searchTimer);searchController?.abort();const version=++searchVersion,q=$('#search').value.trim();$('#results').innerHTML='';$('#search-status').textContent='';
  if(q.length<2)return;
  searchTimer=setTimeout(async()=>{
    searchController=new AbortController();$('#search-status').textContent='Recherche en cours…';
    try{
      const data=await api('/api/search?q='+encodeURIComponent(q),undefined,searchController.signal);if(version!==searchVersion)return;
      $('#search-status').textContent=data.results.length?'Choisis ton film.':'Aucun film trouvé dans le catalogue Apple France. Essaie un autre titre ou utilise l’ajout manuel.';
      $('#results').innerHTML=data.results.map((f,i)=>`<button type="button" class="result" data-result="${i}">${f.poster?`<img src="${esc(f.poster)}" alt="">`:''}<span>${esc(f.title)}<small>${esc(f.year)}</small></span></button>`).join('');
      $('#results').querySelectorAll('button').forEach(b=>b.onclick=()=>{selectedFilm=data.results[Number(b.dataset.result)];$('#selection').textContent=selectedFilm.title+' ('+selectedFilm.year+') sélectionné';$('#results').innerHTML='';$('#manual').open=false;$('#proposal-form').elements.title.value='';});
    }catch(e){if(e.name!=='AbortError'&&version===searchVersion)$('#search-status').textContent=e.message;}
  },500);
});
$('#manual').addEventListener('input',()=>{selectedFilm=null;$('#selection').textContent='';});
$('#proposal-form').onsubmit=async event=>{
  event.preventDefault();const form=event.target,button=form.querySelector('[type=submit]');button.disabled=true;
  try{
    const film=selectedFilm||{title:form.elements.title.value.trim(),year:form.elements.year.value.trim()};
    if(!film.title)throw new Error('Choisis un film dans la recherche ou saisis son titre.');
    await api('/api/proposal',{...film,member_id:member,week:state.week});$('#proposal-dialog').close();await refresh();toast('Ton film est dans le chapeau.');
  }catch(e){form.querySelector('.form-error').textContent=e.message;}finally{button.disabled=false;}
};
for(let i=0;i<=10;i++)$('#rating-form').elements.score.add(new Option(i+' / 10',i));
$('#rating-form').elements.score.onchange=event=>{if(event.target.value!=='')$('#rating-form').elements.seen.checked=true;};
$('#rating-form').elements.seen.onchange=event=>{if(!event.target.checked)$('#rating-form').elements.score.value='';};
$('#rating-form').onsubmit=async event=>{
  event.preventDefault();const form=event.target,button=form.querySelector('button');button.disabled=true;
  try{await api('/api/rating',{member_id:member,proposal_id:activeFilm.id,seen:form.elements.seen.checked,score:form.elements.score.value===''?null:Number(form.elements.score.value),review:form.elements.review.value});await refresh();$('#film-dialog').close();toast('Ton avis est enregistré.');}
  catch(e){form.querySelector('.form-error').textContent=e.message;}finally{button.disabled=false;}
};
$('#filter').onchange=renderWall;$('#wall-search').oninput=renderWall;
window.addEventListener('hashchange',()=>{if(state)render();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
setInterval(()=>{if(!document.hidden&&!document.querySelector('dialog[open]'))refresh();},15000);
refresh();
