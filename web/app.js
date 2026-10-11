'use strict';
const $ = id => document.getElementById(id);
let accountId='',state=null,tab='notFollowingBack',poll=null;
function text(id,v){$(id).textContent=v==null?'':String(v)}
function show(id,yes){$(id).classList.toggle('hidden',!yes)}
function date(v){return v?new Date(v).toLocaleString('tr-TR',{dateStyle:'medium',timeStyle:'short'}):'–'}
function escapeHTML(x){return String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
async function api(url,payload){
 const opt=payload===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)};
 const res=await fetch(url,opt);let data;try{data=await res.json()}catch{data={error:'Geçersiz sunucu yanıtı'}}
 if(!res.ok)throw Error(data.error||('HTTP '+res.status));return data;
}
async function enter(){try{const r=await api('/api/auth');show('authView',!r.authenticated);show('dashboard',r.authenticated);show('logout',r.authenticated);if(r.authenticated)await refresh()}catch(e){text('adminMessage',e.message)}}
$('adminForm').onsubmit=async e=>{e.preventDefault();const btn=e.submitter;btn.disabled=true;try{await api('/api/admin/login',{password:$('adminPass').value});$('adminPass').value='';text('adminMessage','');await enter()}catch(err){text('adminMessage',err.message)}finally{btn.disabled=false}};
$('logout').onclick=async()=>{await api('/api/admin/logout',{});state=null;accountId='';await enter()};
$('igForm').onsubmit=async e=>{e.preventDefault();const btn=$('igButton');btn.disabled=true;text('igMessage','Instagram bağlantısı kuruluyor...');try{const res=await api('/api/instagram/login',{username:$('igUser').value.trim(),password:$('igPass').value});$('igPass').value='';show('twoForm',!!res.needs2fa);text('igMessage',res.needs2fa?'Instagram 2FA kodunu gir.':'Instagram bağlandı. Şimdi tara.');if(res.id){accountId=res.id;await refresh()}}catch(err){$('igPass').value='';text('igMessage',err.message)}finally{btn.disabled=false}};
$('twoForm').onsubmit=async e=>{e.preventDefault();const btn=e.submitter;btn.disabled=true;try{const res=await api('/api/instagram/2fa',{code:$('igCode').value.trim()});$('igCode').value='';show('twoForm',false);text('igMessage','Hesap bağlandı.');accountId=res.id;await refresh()}catch(err){text('igMessage',err.message)}finally{btn.disabled=false}};
$('accountSelect').onchange=()=>{accountId=$('accountSelect').value;refresh()};
$('scan').onclick=async()=>{try{await api('/api/scan',{id:accountId});text('scanMessage','');refresh()}catch(e){text('scanMessage',e.message)}};
$('print').onclick=()=>window.print();
function drawUsers(id,users){const el=$(id);el.replaceChildren();if(!users||!users.length){const li=document.createElement('li');li.className='muted';li.textContent='Kayıt bulunamadı';el.append(li);return}
 for(const user of users){const li=document.createElement('li'),group=document.createElement('span'),a=document.createElement('a'),small=document.createElement('small');a.href='https://www.instagram.com/'+encodeURIComponent(user.username)+'/';a.rel='noopener noreferrer';a.target='_blank';a.textContent='@'+user.username;small.textContent=user.fullName||'';group.append(a,small);li.append(group);el.append(li)}}
function chosen(){if(!state||!state.snapshot)return [];if(tab==='notFollowingBack')return state.notFollowingBack||[];if(tab==='followers'||tab==='following')return state.snapshot[tab]||[];return (state.report||{})[tab]||[]}
function drawList(){let users=chosen(),q=$('search').value.trim().toLowerCase();if(q)users=users.filter(u=>(u.username||'').toLowerCase().includes(q)||(u.fullName||'').toLowerCase().includes(q));text('listCount',users.length+' hesap');drawUsers('list',users)}
$('search').oninput=drawList;
$('tabs').onclick=e=>{const b=e.target.closest('button[data-tab]');if(!b)return;tab=b.dataset.tab;for(const x of $('tabs').children)x.classList.toggle('current',x===b);drawList()};
$('export').onclick=()=>{if(accountId)location.href='/api/csv?id='+encodeURIComponent(accountId)+'&kind='+encodeURIComponent(tab)};
function render(){if(!state)return;const s=state,accounts=s.accounts||[],connected=new Set(s.connected||[]);const select=$('accountSelect');select.replaceChildren();
 for(const acc of accounts){const opt=document.createElement('option');opt.value=acc.id;opt.textContent='@'+acc.username+' ('+acc.id+')'+(connected.has(acc.id)?' • bağlı':'');select.append(opt)}
 if(accounts.length===0){const opt=document.createElement('option');opt.value='';opt.textContent='Henüz hesap kaydedilmedi';select.append(opt)}
 accountId=s.selectedId||accountId;select.value=accountId;
 const connectedNow=connected.has(accountId);$('scan').disabled=s.job.running||!connectedNow;
 text('status',connectedNow?'Instagram bağlı. Tarama yalnızca düğmeyle yapılır.':'Tarama için Instagram hesabına giriş yap.');
 show('progress',s.job.running||!!s.job.error);text('progress',s.job.log||'');text('scanMessage',s.job.error||'');text('scan',s.job.running?'Taranıyor...':'Şimdi tara');
 const snap=s.snapshot,rep=s.report;show('results',!!snap);if(!snap)return;
 text('countFollowers',snap.followers?.length||0);text('countFollowing',snap.following?.length||0);text('countNotBack',(s.notFollowingBack||[]).length);text('countUnfollowed',(rep?.unfollowedYou||[]).length);
 text('range',rep?date(rep.from)+' → '+date(rep.to):'İlk kayıt: '+date(snap.takenAt)+'. Değişiklikler sonraki taramada görünecek.');
 drawUsers('lostList',rep?.unfollowedYou||[]);drawUsers('newList',rep?.newFollowers||[]);
 const tbody=$('history');tbody.replaceChildren();for(const h of [...(s.history||[])].reverse()){
  const tr=document.createElement('tr');for(const v of [date(h.takenAt),h.followers,h.following,h.first?'–':h.unfollowedYou,h.first?'–':h.newFollowers]){const td=document.createElement('td');td.textContent=v;tr.append(td)}tbody.append(tr)}drawList()
}
async function refresh(){try{const q=accountId?'?id='+encodeURIComponent(accountId):'';state=await api('/api/state'+q);render();clearTimeout(poll);if(state.job.running)poll=setTimeout(refresh,1800)}catch(e){if(e.message.includes('Admin şifresi')){clearTimeout(poll);await enter()}else{text('scanMessage',e.message)}}}
enter();

