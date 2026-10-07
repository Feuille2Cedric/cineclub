const $ = s => document.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state, member, selectedFilm, activeFilm, searchTimer, searchController, searchVersion=0, loading=false;
try {member=Number(localStorage.getItem('cineclub.member'));} catch {}
const name = id => state.members.find(m=>m.id===id)?.name || 'Ancien membre';
const mine = id => state.ratings.find(r=>r.proposal_id===id && r.member_id===member);
const status = id => mine(id)?.score != null ? 'Noté · '+mine(id).score+'/10' : mine(id)?.seen ? 'Vu · à noter':'À voir';
const picture = film => trustedImage(film.poster) ? `<img src="${esc(film.poster)}" alt="Affiche de ${esc(film.title)}" loading="lazy">`:`<span class="placeholder">${esc(film.title)}</span>`;
const pretty = value => new Date(value+'T12:00:00').toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'});
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;setTimeout(()=>$('#toast').hidden=true,3500);}
const storeLink = film => trustedStore(film.store_url) ? `<a class="store-link" href="${esc(film.store_url)}" target="_blank" rel="noopener">Voir la fiche</a>` : '';
function card(film){
  const scores=state.ratings.filter(r=>r.proposal_id===film.id && r.score!=null);
  const average=scores.length?(scores.reduce((n,r)=>n+r.score,0)/scores.length).toLocaleString('fr-FR',{maximumFractionDigits:1})+'/10':'Aucune note';
  const myRating=mine(film.id), isOpen=!state.draws.some(d=>d.week===film.week);
  const scoreButtons=Array.from({length:11},(_,n)=>`<button type="button" data-quick-score="${n}" data-film="${film.id}" class="${myRating?.score===n?'selected':''}" aria-pressed="${myRating?.score===n}">${n}</button>`).join('');
  return `<article class="card"><div class="card-top"><span class="proposer"><span class="avatar">${esc(name(film.member_id)[0])}</span>${esc(name(film.member_id))}</span><span class="card-number">${esc(film.year)}</span></div><button class="cover" data-film="${film.id}" aria-label="Voir et noter ${esc(film.title)}">${picture(film)}</button><div class="card-body"><div class="album-info"><h2>${esc(film.title)}</h2><p class="artist">${film.director?'Un film de '+esc(film.director):'Réalisateur non renseigné'}</p></div><div class="rating"><div class="rating-heading"><span>${myRating?.seen?'Vu':'À voir'}</span><span class="personal-score">${myRating?.score!=null?'Ma note : '+myRating.score+'/10':'À noter'}</span></div><div class="scores" role="group" aria-label="Ma note pour ${esc(film.title)}">${scoreButtons}</div><label class="seen-toggle"><input type="checkbox" data-seen="${film.id}" ${myRating?.seen?'checked':''}> J’ai vu ce film</label></div><div class="reviews">${state.ratings.filter(r=>r.proposal_id===film.id&&r.review).map(r=>`<p class="review-chip"><strong>${esc(name(r.member_id))}${r.score!=null?' · '+r.score+'/10':''}</strong>${esc(r.review)}</p>`).join('')}</div></div><div class="rating-footer"><span class="average-label"><b>${average}</b> · ${scores.length} avis</span>${film.member_id===member&&isOpen?`<button class="delete-album" data-remove="${film.id}" aria-label="Retirer ma proposition">Retirer</button>`:''}</div></article>`;
}
function feature(draw){
  const film=state.proposals.find(f=>f.id===draw.proposal_id);
  if(!film)return '';
  const scores=state.ratings.filter(r=>r.proposal_id===film.id&&r.score!=null), average=scores.length?(scores.reduce((n,r)=>n+r.score,0)/scores.length).toLocaleString('fr-FR',{maximumFractionDigits:1}):null;
  return `<article class="feature"><div class="feature-poster">${picture(film)}</div><div class="feature-copy"><span class="eyebrow"><i></i> LE CHOIX DE LA SEMAINE · ${esc(pretty(draw.week))}</span><h2>${esc(film.title)}</h2><p class="feature-director">${film.director?'Un film de '+esc(film.director):'Réalisateur non renseigné'}</p><p class="feature-meta">${esc(film.year)} · Proposé par ${esc(name(film.member_id))}</p>${film.overview?`<p class="feature-overview">${esc(film.overview)}</p>`:''}<div class="feature-rating"><strong>${average===null?'—':average+'/10'}</strong><span>${scores.length} note${scores.length===1?'':'s'} du club</span><span class="seen-count">${state.ratings.filter(r=>r.proposal_id===film.id&&r.seen).length} membre(s) l’ont vu</span></div><button class="primary" data-film="${film.id}">Voir la fiche et noter</button></div></article>`;
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
  const route=['week','draw','history','posters'].includes(location.hash.slice(1))?location.hash.slice(1):'week';
  for(const view of ['week','draw','history','posters'])$(`#${view}-view`).hidden=route!==view;
  document.querySelectorAll('nav a').forEach(a=>{a.removeAttribute('aria-current');if(a.hash==='#'+route)a.setAttribute('aria-current','page');});
  const proposals=state.proposals.filter(p=>p.week===state.week);
  const closed=state.draws.some(d=>d.week===state.week);
  $('#propose').disabled=closed||proposals.some(p=>p.member_id===member);
  $('#propose').textContent=closed?'Les propositions sont closes':$('#propose').disabled?'Ta proposition est enregistrée':'+ Proposer un film';
  $('#deadline').textContent=closed?'Tirage effectué. Les nouvelles propositions ouvriront lundi.':'Semaine du '+pretty(state.week)+' · Tirage lancé par Cédric.';
  $('#draw-controls').hidden=member!==state.draw_admin_id;
  if(route==='draw')$('#draw-page-controls').replaceChildren($('#draw-controls'));
  else $('#week-view').append($('#draw-controls'));
  const pending=[...new Set(state.proposals.map(p=>p.week))].filter(w=>w<=state.week&&!state.draws.some(d=>d.week===w)).sort().reverse();
  const selectedWeek=$('#draw-week').value;
  $('#draw-week').innerHTML=pending.map(w=>`<option value="${w}">Semaine du ${esc(pretty(w))}</option>`).join('');
  if(pending.includes(selectedWeek))$('#draw-week').value=selectedWeek;
  updateDraw();
  $('#progress').textContent=proposals.length+' / '+state.members.length+' propositions';
  $('#member-avatars').innerHTML=state.members.map((m,i)=>`<span class="avatar" style="--tint:${['#e3e7d7','#f3d9c9','#d9e2ef','#eadcf0','#f0e2b8','#d7e8e2'][i%6]}" title="${esc(m.name)}">${esc(m.name[0])}</span>`).join('');
  const currentDraw=state.draws.find(d=>d.week===state.week);
  $('#winner').innerHTML=currentDraw?feature(currentDraw):'';
  const waiting=state.members.filter(m=>!proposals.some(p=>p.member_id===m.id));
  $('#proposals').innerHTML=proposals.map(card).join('')+waiting.map(m=>`<article class="empty-card"><span class="waiting-avatar">${esc(m.name[0])}</span><h2>${esc(m.name)}</h2><p>${m.id===member?'À toi de proposer la prochaine découverte.':'Sa proposition arrive bientôt.'}</p></article>`).join('');
  fitProposalColumns();
  $('#history').innerHTML=state.draws.length?state.draws.map(d=>`<section class="archive">${feature(d)}<details><summary>Les propositions du ${esc(pretty(d.week))}</summary><div class="grid">${state.proposals.filter(p=>p.week===d.week).map(card).join('')}</div></details></section>`).join(''):'<div class="empty">Les séances apparaîtront ici après le premier tirage.</div>';
  renderWall();
}
function fitProposalColumns(){
  const grid=$('#proposals'),count=state?.members.length||1,width=grid.clientWidth||window.innerWidth-88,max=Math.max(1,Math.min(count,Math.floor(width/250)));
  let best=1,bestRows=Infinity,bestSpread=Infinity;
  for(let columns=1;columns<=max;columns++){
    const rows=Math.ceil(count/columns),small=Math.floor(count/rows),large=Math.ceil(count/rows),spread=large-small;
    if(rows<bestRows||(rows===bestRows&&spread<bestSpread)){best=columns;bestRows=rows;bestSpread=spread;}
  }
  grid.style.setProperty('--columns',best);
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
  $('#film-details').innerHTML=`<h2>${esc(activeFilm.title)}</h2><p>${esc(activeFilm.year)}${activeFilm.director?' · Réalisé par '+esc(activeFilm.director):''} · Proposé par ${esc(name(activeFilm.member_id))}</p>${activeFilm.overview?`<p>${esc(activeFilm.overview)}</p>`:''}${trustedStore(activeFilm.store_url)?`<p>${storeLink(activeFilm)}</p>`:''}`;
  form.elements.seen.checked=!!r?.seen;form.elements.score.value=r?.score??'';form.elements.review.value=r?.review||'';form.querySelector('.form-error').textContent='';
  $('#reviews').innerHTML='<h3>Les avis du club</h3>'+state.ratings.filter(v=>v.proposal_id===id&&(v.score!=null||v.review)).map(v=>`<div class="review"><strong>${esc(name(v.member_id))}</strong> · ${v.score!=null?v.score+'/10':'Sans note'}<p>${esc(v.review)}</p></div>`).join('');
  if(!$('#film-dialog').open)$('#film-dialog').showModal();
}
document.addEventListener('click',async event=>{
  const b=event.target.closest('button');if(!b)return;
  if(b.hasAttribute('data-close')){b.closest('dialog').close();return;}
  if(b.dataset.member){member=Number(b.dataset.member);try{localStorage.setItem('cineclub.member',member);}catch{}render();}
  if(b.dataset.film&&!b.dataset.quickScore)openFilm(Number(b.dataset.film));
  if(b.dataset.quickScore!==undefined){
    const filmId=Number(b.dataset.film), current=mine(filmId), score=Number(b.dataset.quickScore);
    b.disabled=true;
    try{await api('/api/rating',{member_id:member,proposal_id:filmId,seen:true,score,review:current?.review||''});await refresh();}
    catch(e){toast(e.message);}finally{b.disabled=false;}
  }
  if(b.id==='retry')refresh();
  if(b.dataset.remove){
    b.disabled=true;
    try{await api('/api/remove',{member_id:member,week:state.week});await refresh();toast('Proposition retirée.');}
    catch(e){toast(e.message);}finally{b.disabled=false;}
  }
});
document.addEventListener('change',async event=>{
  const input=event.target.closest('[data-seen]');if(!input)return;
  const filmId=Number(input.dataset.seen),current=mine(filmId);
  try{await api('/api/rating',{member_id:member,proposal_id:filmId,seen:input.checked,score:input.checked?(current?.score??null):null,review:current?.review||''});await refresh();}
  catch(e){input.checked=!input.checked;toast(e.message);}
});
function updateDraw(){
  const week=$('#draw-week').value;
  const count=state.proposals.filter(p=>p.week===week).length;
  $('#draw').disabled=!week||!count;
  $('#draw-help').textContent=count?count+' proposition'+(count>1?'s':'')+' dans cette session. Le résultat sera définitif.':'Aucune session avec des propositions en attente de tirage.';
}
$('#draw-week').onchange=updateDraw;
$('#draw').onclick=async()=>{
  const week=$('#draw-week').value;
  if(!week||!confirm('Lancer le tirage de la session du '+pretty(week)+' ? Les propositions seront closes et le résultat définitif.'))return;
  $('#draw').disabled=true;
  try{
    const result=await api('/api/draw',{member_id:member,week});
    await refresh();
    const film=state.proposals.find(p=>p.id===result.proposal_id);
    toast((result.already_drawn?'Film déjà sélectionné : ':'Le film sélectionné : ')+(film?.title||''));
    if(film)openFilm(film.id);
  }catch(e){toast(e.message);}finally{updateDraw();}
};
$('#profile').onclick=()=>{member=null;try{localStorage.removeItem('cineclub.member');}catch{}render();};
$('#add-member').onclick=()=>{$('#member-form').reset();$('#member-form .form-error').textContent='';$('#member-dialog').showModal();$('#member-form [name=name]').focus();};
$('#member-form').onsubmit=async event=>{event.preventDefault();const form=event.target,button=form.querySelector('button.primary');button.disabled=true;try{await api('/api/member',{name:form.elements.name.value.trim()});$('#member-dialog').close();await refresh();toast('Personne ajoutée au club.');}catch(e){form.querySelector('.form-error').textContent=e.message;}finally{button.disabled=false;}};
$('#propose').onclick=()=>{selectedFilm=null;$('#proposal-form').reset();$('#selection').textContent='';$('#results').innerHTML='';$('#proposal-form .form-error').textContent='';$('#search-status').textContent='';$('#proposal-dialog').showModal();$('#search').focus();};
$('#proposal-dialog').addEventListener('close',()=>{searchController?.abort();clearTimeout(searchTimer);searchVersion++;});
$('#search').addEventListener('input',()=>{
  clearTimeout(searchTimer);searchController?.abort();const version=++searchVersion,q=$('#search').value.trim();$('#results').innerHTML='';$('#search-status').textContent='';
  if(q.length<2)return;
  searchTimer=setTimeout(async()=>{
    searchController=new AbortController();$('#search-status').textContent='Recherche en cours…';
    try{
      const data=await api('/api/search?q='+encodeURIComponent(q),undefined,searchController.signal);if(version!==searchVersion)return;
      $('#search-status').textContent=data.results.length?'Choisis ton film.':'Aucun film trouvé dans TMDB. Essaie un autre titre ou utilise l’ajout manuel.';
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
window.addEventListener('resize',()=>{if(state)fitProposalColumns();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
setInterval(()=>{if(!document.hidden&&!document.querySelector('dialog[open]'))refresh();},15000);
refresh();

