const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const token=()=>localStorage.getItem('fitalpro_access_token')||'';
const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money={Питание:'990 ₽',PRO:'1 990 ₽',Premium:'3 990 ₽'};
const menu=$('#nav'),toggle=$('#menuToggle');
toggle?.addEventListener('click',()=>menu?.classList.toggle('open'));
$$$('#nav a').forEach(a=>a.addEventListener('click',()=>menu?.classList.remove('open')));
const PLAN_DURATIONS={'Питание':7,PRO:14,Premium:30};
const PLAN_LABELS={'Питание':'Питание',PRO:'PRO',Premium:'Premium'};
function syncSelectedPlan(code){
 if(!PLAN_DURATIONS[code])return;
 const picker=$('#planSelect');if(picker)picker.value=code;
 const trainingFields=$('#trainingFields');if(trainingFields)trainingFields.hidden=code==='Питание';
 localStorage.setItem('fitalpro_selected_plan',code);
 const note=$('#selectedPlanNote');
 if(note)note.textContent='Выбран тариф '+PLAN_LABELS[code]+' — программа на '+PLAN_DURATIONS[code]+' дней.';
}
$$('[data-plan]').forEach(b=>b.addEventListener('click',()=>{
 if(token()){
  const active=localStorage.getItem('fitalpro_subscription_plan');
  if(active)syncSelectedPlan(active);
  note.textContent='Активная подписка сохраняет свой тариф и срок программы.';
  $('#profile')?.scrollIntoView({behavior:'smooth'});return;
 }
 const code=b.dataset.plan;syncSelectedPlan(code);
 if(currentProfile&&localStorage.getItem('fitalpro_plan_code')!==code)requestPlan({...currentProfile,plan:code,pd_consent:'on'});
 $('#profile')?.scrollIntoView({behavior:'smooth'});
}));
const form=$('#profileForm'),note=$('#profileNote'),planCard=$('#planCard'),empty=$('#previewEmpty');
let currentDraft=localStorage.getItem('fitalpro_plan_draft')||'';
let currentProfile=null;
try{currentProfile=JSON.parse(localStorage.getItem('fitalpro_profile')||'null');if(currentProfile&&form)Object.entries(currentProfile).forEach(([k,v])=>{const el=form.elements[k];if(el&&el.type!=='checkbox')el.value=v;});}catch(_){}
const savedPlan=localStorage.getItem('fitalpro_selected_plan');
syncSelectedPlan(PLAN_DURATIONS[savedPlan]?savedPlan:($('#planSelect')?.value||'PRO'));
function syncPaidFeatures(plan){
 const enhanced=['PRO','Premium'].includes(plan);
 const progressBox=$('#progressBox');if(progressBox)progressBox.hidden=!enhanced;
 const chatInput=$('#chatInput'),chatForm=$('#chatForm'),chatNote=$('#chatNote');
 if(chatInput)chatInput.disabled=!enhanced;
 const submit=chatForm?.querySelector('button');if(submit)submit.disabled=!enhanced;
 if(chatNote)chatNote.textContent=enhanced?'Fital AI доступен в рамках активного тарифа.':'AI-помощник и отслеживание прогресса доступны в PRO и Premium после оплаты.';
}
function renderProgramDays(plan,target){
 if(!target)return;
 const fragment=document.createDocumentFragment();
 (Array.isArray(plan?.week)?plan.week:[]).forEach((day,index)=>{
  const article=document.createElement('details');article.className='day-plan';article.open=Number(day.day||index+1)<=7;
  const summary=document.createElement('summary');
  const heading=document.createElement('h4');heading.textContent='День '+(day.day||index+1);summary.append(heading);
  const blocks=[summary];
  if(day.training){
   const training=document.createElement('p');training.className='training-line';training.textContent=String(day.training);
   blocks.push(training);
  }
  const mealsList=document.createElement('ul');mealsList.className='day-meals';
  const meals=Array.isArray(day.meals)?day.meals:Object.entries(day.meals||{}).map(([type,value])=>typeof value==='string'?{type,name:value}:{...value,type:value.type||type});
  meals.forEach(meal=>{
   const li=document.createElement('li');li.className='meal-row';
   const name=document.createElement('span');name.className='meal-name';name.textContent=String(meal.name||'Приём пищи');
   const meta=document.createElement('small');meta.className='meal-meta';meta.textContent=String(meal.kcal??'—')+' ккал · белок '+String(meal.protein??'—')+' г';
   li.append(name,meta);
   const ingredients=Array.isArray(meal.ingredients)?meal.ingredients:[];
   if(ingredients.length){
    const details=document.createElement('details');details.className='meal-ingredients';
    const label=document.createElement('summary');label.textContent='Состав и количество';details.append(label);
    const list=document.createElement('ul');
    ingredients.forEach(pair=>{
     if(!Array.isArray(pair)||pair.length<2)return;
     const row=document.createElement('li');row.textContent=String(pair[0])+' — '+String(pair[1]);list.append(row);
    });
    details.append(list);li.append(details);
   }
   mealsList.append(li);
  });
  blocks.push(mealsList);article.append(...blocks);fragment.append(article);
 });
 target.replaceChildren(fragment);
}
function renderShoppingList(plan,target){
 if(!target)return;
 const items=Array.isArray(plan?.shopping)?plan.shopping:[];
 target.replaceChildren();
 if(!items.length){target.hidden=true;return;}
 target.hidden=false;
 const heading=document.createElement('h4');heading.textContent='Список покупок на всю программу';
 const hint=document.createElement('p');hint.className='shopping-hint';hint.textContent='Количество рассчитано по ингредиентам всех дней программы.';
 const list=document.createElement('ul');
 items.forEach(item=>{
  const row=document.createElement('li');
  const name=document.createElement('span');name.textContent=String(item.item||'Продукт');
  const amount=document.createElement('small');amount.textContent=String(item.amount||'по меню');
  row.append(name,amount);list.append(row);
 });
 target.append(heading,hint,list);
 const substitutions=Object.entries(plan?.substitutions||{});
 if(substitutions.length){
  const details=document.createElement('details');details.className='substitutions';
  const summary=document.createElement('summary');summary.textContent='Варианты замены продуктов';details.append(summary);
  const replacements=document.createElement('ul');
  substitutions.forEach(([item,alternatives])=>{
   const row=document.createElement('li');
   row.textContent=String(item)+': '+(Array.isArray(alternatives)?alternatives.join(', '):String(alternatives));
   replacements.append(row);
  });
  details.append(replacements);target.append(details);
 }
}
function renderPlan(plan){
 if(!plan||!planCard)return;
 empty.hidden=true;planCard.hidden=false;
 $('#planCalories').textContent=(plan.calories||'—')+' ккал';
 $('#planProtein').textContent=(plan.protein||'—')+' г';
 const trainingIncluded=plan.trainingIncluded!==false;
 $('#planDaysLabel').textContent=trainingIncluded?'ТРЕНИРОВОК В НЕДЕЛЮ':'ТРЕНИРОВКИ';
 $('#planDays').textContent=trainingIncluded?(plan.days||'—')+'× / нед.':'Не входят';
 const programDays=Number(plan.programDays)||(Array.isArray(plan.week)?plan.week.length:7);
 $('#planSummary').textContent='Цель: '+(plan.goal||'поддержание')+'. Среднее меню: '+(plan.averageDaily?.kcal||plan.calories)+' ккал и '+(plan.averageDaily?.protein||plan.protein)+' г белка в день.';
 $('#planDuration').textContent='Полная программа: '+programDays+' дней. Меню — четыре приёма пищи в день.'+(plan.trainingIncluded===false?' Тренировки не входят в этот тариф.':' Тренировки и восстановление включены.');
 $('#previewStatus').textContent='ПЛАН НА '+programDays+' ДНЕЙ ГОТОВ';
 renderProgramDays(plan,$('#weekPlan'));
 renderShoppingList(plan,$('#shoppingList'));
}
async function requestPlan(data){
 const button=$('#planSubmit');button.disabled=true;button.textContent='ИИ составляет план…';note.textContent='Проверяем анкету и формируем меню и рекомендации.';
 try{
  const paid=!!token();
  const planCode=paid?(localStorage.getItem('fitalpro_subscription_plan')||localStorage.getItem('fitalpro_selected_plan')||'PRO'):(data.plan||$('#planSelect')?.value||localStorage.getItem('fitalpro_selected_plan')||'PRO');
  const payload={...data,plan:planCode};
  if(!paid){currentDraft='';localStorage.removeItem('fitalpro_plan_draft');localStorage.removeItem('fitalpro_plan_code');}
  const response=await fetch(paid?'/api/profile':'/api/plan-preview',{method:'POST',headers:{'Content-Type':'application/json',...(paid?{Authorization:'Bearer '+token()}:{})},body:JSON.stringify(payload)});
  const result=await response.json();
  if(!response.ok||!result.plan||(!paid&&!result.draft_id))throw new Error(result.error||'Не удалось подготовить персональный план.');
  currentDraft=paid?'':result.draft_id;currentProfile=payload;
  syncSelectedPlan(planCode);
  if(paid){localStorage.removeItem('fitalpro_plan_draft');localStorage.removeItem('fitalpro_plan_code');note.textContent='Профиль и персональный план обновлены.';}
  else{localStorage.setItem('fitalpro_plan_draft',currentDraft);localStorage.setItem('fitalpro_plan_code',planCode);note.textContent='Ваш предварительный план на '+(result.plan.programDays||result.plan.week.length)+' дней готов. Тариф и программа связаны.';}
  localStorage.setItem('fitalpro_profile',JSON.stringify(payload));localStorage.setItem('fitalpro_preview_profile',JSON.stringify(payload));
  renderPlan(result.plan);
 }catch(error){note.textContent=error.message||'Не удалось сформировать план. Попробуйте ещё раз.';}
 finally{button.disabled=false;button.innerHTML='Рассчитать мой план <span>↗</span>';}
}
form?.addEventListener('submit',e=>{
 e.preventDefault();if(!$('#consent').checked){note.textContent='Подтвердите согласие и возраст 18+.';return;}
 const data=Object.fromEntries(new FormData(form).entries());
 for(const key of ['age','height','weight','days'])data[key]=Number(data[key]);
 if(data.age<18||data.age>80||data.days<2||data.days>7){note.textContent='Проверьте возраст и количество тренировок в неделю.';return;}
 data.plan=$('#planSelect')?.value||localStorage.getItem('fitalpro_selected_plan')||'PRO';
 requestPlan(data);
});
$('#planSelect')?.addEventListener('change',()=>{
 if(token()){
  const active=localStorage.getItem('fitalpro_subscription_plan');
  if(active)syncSelectedPlan(active);
  return;
 }
 const code=$('#planSelect').value;syncSelectedPlan(code);
 if(currentProfile&&localStorage.getItem('fitalpro_plan_code')!==code)requestPlan({...currentProfile,plan:code,pd_consent:'on'});
});
$('#checkoutButton')?.addEventListener('click',async()=>{
 const plan=$('#planSelect').value,draftId=localStorage.getItem('fitalpro_plan_draft');
 if(!draftId){note.textContent='Сначала заполните анкету и получите персональную программу.';$('#profile')?.scrollIntoView({behavior:'smooth'});return;}
 if(localStorage.getItem('fitalpro_plan_code')!==plan){note.textContent='Меню ещё не рассчитано для выбранного тарифа. Сформируйте программу заново.';$('#profile')?.scrollIntoView({behavior:'smooth'});return;}
 const button=$('#checkoutButton');button.disabled=true;button.textContent='Создаём оплату…';
 try{
  const r=await fetch('/api/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({plan,draft_id:draftId})});
  const d=await r.json();if(!r.ok||!d.confirmation_url)throw new Error(d.error||'Оплата пока недоступна.');
  localStorage.setItem('fitalpro_selected_plan',plan);location.href=d.confirmation_url;
 }catch(err){note.textContent=err.message||'Не удалось создать платёж.';button.disabled=false;button.textContent='Перейти к оплате ↗';}
});
async function paymentReturn(){
 const p=new URLSearchParams(location.search),ref=p.get('Shp_client_ref')||p.get('shp_client_ref')||p.get('payment_ref'),id=p.get('InvId')||p.get('payment_id');
 const panel=$('#paymentResult'),retry=$('#paymentRetry');
 if(p.get('payment')==='failed'){
  panel.hidden=false;
  $('#paymentTitle').textContent='Оплата не завершена';
  $('#paymentText').textContent='Robokassa не подтвердила успешный платёж. Проверьте статус операции в банке или кабинете Robokassa. Если списания нет, вернитесь к анкете, подтвердите согласие и сформируйте новый план для повторной оплаты.';
  if(retry)retry.hidden=false;
  return;
 }
 if(!ref&&!id)return;
 panel.hidden=false;$('#paymentTitle').textContent='Проверяем оплату';$('#paymentText').textContent='Ожидаем подтверждение Robokassa. Не закрывайте страницу.';
 if(retry)retry.hidden=true;
 for(let i=0;i<18;i++){
  try{
   const q=ref?'ref='+encodeURIComponent(ref):'id='+encodeURIComponent(id);
   const r=await fetch('/api/payment-status?'+q,{cache:'no-store'}),d=await r.json();
   if(d.status==='active'&&d.access_token){localStorage.setItem('fitalpro_access_token',d.access_token);localStorage.removeItem('fitalpro_plan_draft');localStorage.removeItem('fitalpro_plan_code');$('#paymentTitle').textContent='Оплата подтверждена';$('#paymentText').textContent='Доступ активирован. Открываем личный кабинет.';$('#cabinet').scrollIntoView({behavior:'smooth'});await loadCabinet();return;}
   if(d.status==='expired'){throw new Error('Срок доступа завершён.');}
  }catch(e){if(e.message==='Срок доступа завершён.')$('#paymentText').textContent=e.message;}
  await new Promise(resolve=>setTimeout(resolve,2500));
 }
 $('#paymentTitle').textContent='Подтверждение ещё выполняется';$('#paymentText').textContent='Если платёж прошёл, обновите страницу через минуту. Доступ выдаётся только после уведомления Robokassa.';
}
async function loadCabinet(){
 const box=$('#memberContent'),lock=$('#memberLock');
 if(!token()){syncPaidFeatures(null);box.hidden=true;$('#memberTitle').textContent='Доступ пока не активирован';$('#memberText').textContent='После успешной оплаты Robokassa откроется ваш личный кабинет.';lock.textContent='⌑';return;}
 try{
  const headers={Authorization:'Bearer '+token()},r=await fetch('/api/me',{headers,cache:'no-store'}),d=await r.json();
  if(!r.ok||d.subscription?.status!=='active')throw new Error();
  const activePlan=d.subscription.plan;
  if(PLAN_DURATIONS[activePlan]){
   localStorage.setItem('fitalpro_subscription_plan',activePlan);
   syncSelectedPlan(activePlan);
   syncPaidFeatures(activePlan);
   const picker=$('#planSelect');if(picker)picker.disabled=true;
  }
  $('#memberTitle').textContent='Ваш доступ активен';$('#memberText').textContent='Тариф: '+d.subscription.plan+'. Доступ до '+new Date(d.subscription.expires_at).toLocaleDateString('ru-RU');lock.textContent='✓';box.hidden=false;
  const pr=await fetch('/api/plan',{headers,cache:'no-store'}),pd=await pr.json();
  const target=$('#memberPlan');target.replaceChildren();
  if(pr.ok&&pd.plan){
   const programDays=Number(pd.plan.programDays)||(pd.plan.week||[]).length;
   const overview=document.createElement('p');overview.className='member-plan-overview';overview.textContent='Программа на '+programDays+' дней · '+pd.plan.calories+' ккал · '+pd.plan.protein+' г белка в день.'+(pd.plan.trainingIncluded===false?' · без тренировок':' · с тренировками');
   const days=document.createElement('div');days.className='member-program-days';
   target.replaceChildren(overview,days);
   renderProgramDays(pd.plan,days);
   renderShoppingList(pd.plan,$('#memberShoppingList'));
  }
  if(['PRO','Premium'].includes(activePlan)) await loadProgress(headers);
 }catch(_){syncPaidFeatures(null);localStorage.removeItem('fitalpro_access_token');localStorage.removeItem('fitalpro_subscription_plan');const picker=$('#planSelect');if(picker)picker.disabled=false;box.hidden=true;$('#memberTitle').textContent='Не удалось подтвердить доступ';$('#memberText').textContent='Проверьте подключение и обновите страницу.';lock.textContent='⌑';}
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
 if(!['PRO','Premium'].includes(localStorage.getItem('fitalpro_subscription_plan'))){if(chatNote)chatNote.textContent='AI-помощник доступен после активации PRO или Premium.';return;}
 const q=String(question||'').trim();if(!q)return;
 addChatMessage(q,'user');chatInput.value='';chatNote.textContent='Fital AI готовит ответ…';
 const submit=chatForm?.querySelector('button');if(submit)submit.disabled=true;
 try{const r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json',...(token()?{Authorization:'Bearer '+token()}:{})},body:JSON.stringify({message:q})});const d=await r.json();if(!r.ok)throw new Error(d.error||'AI-помощник временно недоступен.');addChatMessage(d.reply||'Не удалось получить ответ.','bot');chatNote.textContent='Ответ сформирован AI и может содержать неточности.';}
 catch(e){addChatMessage(e.message||'Не удалось получить ответ. Попробуйте позже.','bot');chatNote.textContent='Попробуйте отправить вопрос ещё раз.';}
 finally{if(submit)submit.disabled=false;}
}
chatForm?.addEventListener('submit',e=>{e.preventDefault();sendChatQuestion(chatInput.value);});
$$('[data-question]').forEach(b=>b.addEventListener('click',()=>sendChatQuestion(b.dataset.question)));

paymentReturn();loadCabinet();
