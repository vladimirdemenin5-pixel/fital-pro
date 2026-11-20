const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const token=()=>localStorage.getItem('fitalpro_access_token')||'';
const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money={Питание:'990 ₽',PRO:'1 990 ₽',Premium:'3 990 ₽'};
const menu=$('#nav'),toggle=$('#menuToggle');
toggle?.addEventListener('click',()=>menu?.classList.toggle('open'));
$$('#nav a').forEach(a=>a.addEventListener('click',()=>menu?.classList.remove('open')));
$$('[data-plan]').forEach(b=>b.addEventListener('click',()=>{const s=$('#planSelect');if(s)s.value=b.dataset.plan;$('#profile')?.scrollIntoView({behavior:'smooth'});}));
const form=$('#profileForm'),note=$('#profileNote'),planCard=$('#planCard'),empty=$('#previewEmpty');
let currentDraft=localStorage.getItem('fitalpro_plan_draft')||'';
let currentProfile=null;
try{currentProfile=JSON.parse(localStorage.getItem('fitalpro_profile')||'null');if(currentProfile&&form)Object.entries(currentProfile).forEach(([k,v])=>{const el=form.elements[k];if(el&&el.type!=='checkbox')el.value=v;});}catch(_){}
function renderPlan(plan){
 if(!plan||!planCard)return;
 empty.hidden=true;planCard.hidden=false;$('#previewStatus').textContent='ПЛАН ГОТОВ';
 $('#planCalories').textContent=(plan.calories||'—')+' ккал';
 $('#planProtein').textContent=(plan.protein||'—')+' г';
 $('#planDays').textContent=(plan.days||'—')+'× / нед.';
 $('#planSummary').textContent='Цель: '+(plan.goal||'поддержание')+'. Среднее меню: '+(plan.averageDaily?.kcal||plan.calories)+' ккал и '+(plan.averageDaily?.protein||plan.protein)+' г белка в день.';
 const week=$('#weekPlan');week.replaceChildren();
 (plan.week||[]).forEach(day=>{
  const article=document.createElement('article');article.className='day-plan';
  const h=document.createElement('h4');h.textContent='День '+day.day;
  const training=document.createElement('p');training.className='training-line';training.textContent=day.training||'Восстановление';
  const meals=document.createElement('ul');
  (Array.isArray(day.meals)?day.meals:Object.values(day.meals||{})).forEach(meal=>{
   const li=document.createElement('li');li.textContent=(meal.name||'Приём пищи')+' · '+(meal.kcal||0)+' ккал · белок '+(meal.protein||0)+' г';meals.append(li);
  });
  article.append(h,training,meals);week.append(article);
 });
}
async function requestPlan(data){
 const button=$('#planSubmit');button.disabled=true;button.textContent='ИИ составляет план…';note.textContent='Проверяем анкету и формируем меню и рекомендации.';
 try{
  const paid=!!token();
  const response=await fetch(paid?'/api/profile':'/api/plan-preview',{method:'POST',headers:{'Content-Type':'application/json',...(paid?{Authorization:'Bearer '+token()}:{})},body:JSON.stringify(data)});
  const result=await response.json();
  if(!response.ok||!result.plan||(!paid&&!result.draft_id))throw new Error(result.error||'Не удалось подготовить персональный план.');
  currentDraft=paid?'':result.draft_id;currentProfile=data;
  if(paid){localStorage.removeItem('fitalpro_plan_draft');note.textContent='Профиль и персональный план обновлены.';}
  else{localStorage.setItem('fitalpro_plan_draft',currentDraft);note.textContent='Ваш предварительный план готов. Выберите тариф и перейдите к оплате.';}
  localStorage.setItem('fitalpro_profile',JSON.stringify(data));localStorage.setItem('fitalpro_preview_profile',JSON.stringify(data));
  renderPlan(result.plan);
 }catch(error){note.textContent=error.message||'Не удалось сформировать план. Попробуйте ещё раз.';}
 finally{button.disabled=false;button.innerHTML='Рассчитать мой план <span>↗</span>';}
}
form?.addEventListener('submit',e=>{
 e.preventDefault();if(!$('#consent').checked){note.textContent='Подтвердите согласие и возраст 18+.';return;}
 const data=Object.fromEntries(new FormData(form).entries());
 for(const key of ['age','height','weight','days'])data[key]=Number(data[key]);
 if(data.age<18||data.age>80||data.days<2||data.days>7){note.textContent='Проверьте возраст и количество тренировок в неделю.';return;}
 requestPlan(data);
});
$('#checkoutButton')?.addEventListener('click',async()=>{
 const plan=$('#planSelect').value,draftId=localStorage.getItem('fitalpro_plan_draft');
 if(!draftId){note.textContent='Сначала заполните анкету и получите персональный план.';$('#profile')?.scrollIntoView({behavior:'smooth'});return;}
 const button=$('#checkoutButton');button.disabled=true;button.textContent='Создаём оплату…';
 try{
  const r=await fetch('/api/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({plan,draft_id:draftId})});
  const d=await r.json();if(!r.ok||!d.confirmation_url)throw new Error(d.error||'Оплата пока недоступна.');
  localStorage.setItem('fitalpro_selected_plan',plan);location.href=d.confirmation_url;
 }catch(err){note.textContent=err.message||'Не удалось создать платёж.';button.disabled=false;button.textContent='Перейти к оплате ↗';}
});
async function paymentReturn(){
 const p=new URLSearchParams(location.search),ref=p.get('Shp_client_ref')||p.get('shp_client_ref')||p.get('payment_ref'),id=p.get('InvId')||p.get('payment_id');
 if(!ref&&!id)return;
 const panel=$('#paymentResult');panel.hidden=false;$('#paymentTitle').textContent='Проверяем оплату';$('#paymentText').textContent='Ожидаем подтверждение Robokassa. Не закрывайте страницу.';
 for(let i=0;i<18;i++){
  try{
   const q=ref?'ref='+encodeURIComponent(ref):'id='+encodeURIComponent(id);
   const r=await fetch('/api/payment-status?'+q,{cache:'no-store'}),d=await r.json();
   if(d.status==='active'&&d.access_token){localStorage.setItem('fitalpro_access_token',d.access_token);localStorage.removeItem('fitalpro_plan_draft');$('#paymentTitle').textContent='Оплата подтверждена';$('#paymentText').textContent='Доступ активирован. Открываем личный кабинет.';$('#cabinet').scrollIntoView({behavior:'smooth'});await loadCabinet();return;}
   if(d.status==='expired'){throw new Error('Срок доступа завершён.');}
  }catch(e){if(e.message==='Срок доступа завершён.')$('#paymentText').textContent=e.message;}
  await new Promise(resolve=>setTimeout(resolve,2500));
 }
 $('#paymentTitle').textContent='Подтверждение ещё выполняется';$('#paymentText').textContent='Если платёж прошёл, обновите страницу через минуту. Доступ выдаётся только после уведомления Robokassa.';
}
async function loadCabinet(){
 const box=$('#memberContent'),lock=$('#memberLock');
 if(!token()){box.hidden=true;$('#memberTitle').textContent='Доступ пока не активирован';$('#memberText').textContent='После успешной оплаты Robokassa откроется ваш личный кабинет.';lock.textContent='⌑';return;}
 try{
  const headers={Authorization:'Bearer '+token()},r=await fetch('/api/me',{headers,cache:'no-store'}),d=await r.json();
  if(!r.ok||d.subscription?.status!=='active')throw new Error();
  $('#memberTitle').textContent='Ваш доступ активен';$('#memberText').textContent='Тариф: '+d.subscription.plan+'. Доступ до '+new Date(d.subscription.expires_at).toLocaleDateString('ru-RU');lock.textContent='✓';box.hidden=false;
  const pr=await fetch('/api/plan',{headers,cache:'no-store'}),pd=await pr.json();
  const target=$('#memberPlan');target.replaceChildren();
  if(pr.ok&&pd.plan){const h=document.createElement('p');h.textContent='Ваш персональный план: '+pd.plan.calories+' ккал · '+pd.plan.protein+' г белка в день.';target.append(h);(pd.plan.week||[]).forEach(day=>{const p=document.createElement('p');p.textContent='День '+day.day+': '+day.training+' — '+(Array.isArray(day.meals)?day.meals.map(x=>x.name).join(', '):Object.values(day.meals||{}).map(x=>x.name||x).join(', '));target.append(p);});}
  await loadProgress(headers);
 }catch(_){localStorage.removeItem('fitalpro_access_token');box.hidden=true;$('#memberTitle').textContent='Не удалось подтвердить доступ';$('#memberText').textContent='Проверьте подключение и обновите страницу.';lock.textContent='⌑';}
}
async function loadProgress(headers={Authorization:'Bearer '+token()}){
 try{const r=await fetch('/api/progress',{headers,cache:'no-store'}),d=await r.json();$('#progressHistory').innerHTML=(d.items||[]).slice(0,8).map(x=>'<div class="history-row"><b>'+escapeHtml(x.date)+'</b><span>'+escapeHtml(x.weight)+' кг</span></div>').join('')||'<p class="muted">Записей пока нет.</p>';}catch(_){}
}
$('#progressForm')?.addEventListener('submit',async e=>{
 e.preventDefault();const f=e.currentTarget,data=Object.fromEntries(new FormData(f).entries());data.completed_meal=f.elements.completed_meal.checked?1:0;data.completed_workout=f.elements.completed_workout.checked?1:0;
 const n=$('#progressNote');n.textContent='Сохраняем…';
 try{const r=await fetch('/api/progress',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token()},body:JSON.stringify(data)}),d=await r.json();if(!r.ok)throw new Error(d.error||'Не удалось сохранить.');n.textContent='Прогресс сохранён.';await loadProgress();}catch(err){n.textContent=err.message;}
});

const chatForm=$('#chatForm'),chatInput=$('#chatInput'),chatLog=$('#chatLog'),chatNote=$('#chatNote');
function addChatMessage(text,kind){const el=document.createElement('div');el.className='chat-message '+kind;el.textContent=text;chatLog.append(el);chatLog.scrollTop=chatLog.scrollHeight;}
async function sendChatQuestion(question){
 const q=String(question||'').trim();if(!q)return;
 addChatMessage(q,'user');chatInput.value='';chatNote.textContent='Fital AI готовит ответ…';
 const submit=chatForm?.querySelector('button');if(submit)submit.disabled=true;
 try{const r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json',...(token()?{Authorization:'Bearer '+token()}:{})},body:JSON.stringify({message:q})});const d=await r.json();if(!r.ok)throw new Error(d.error||'AI-помощник временно недоступен.');addChatMessage(d.reply||'Не удалось получить ответ.','bot');chatNote.textContent='Ответ сформирован AI и может содержать неточности.';}
 catch(e){addChatMessage(e.message||'Не удалось получить ответ. Попробуйте позже.','bot');chatNote.textContent='Попробуйте отправить вопрос ещё раз.';}
 finally{if(submit)submit.disabled=false;}
}
chatForm?.addEventListener('submit',e=>{e.preventDefault();sendChatQuestion(chatInput.value);});
$('[data-question]').forEach(b=>b.addEventListener('click',()=>sendChatQuestion(b.dataset.question)));

paymentReturn();loadCabinet();
