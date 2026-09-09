const MODEL = '@cf/meta/llama-3.1-8b-instruct';
const PLANS = {
  'Питание': { amount: '990.00', label: 'Fital Pro — Питание, 7 дней' },
  'PRO': { amount: '1990.00', label: 'Fital Pro PRO — питание + тренировки, 14 дней' },
  'Premium': { amount: '3990.00', label: 'Fital Pro Premium — сопровождение, 30 дней' }
};

const json = (data, status=200) => new Response(JSON.stringify(data), {status, headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const clean = (v,max=500) => String(v ?? '').trim().slice(0,max);
async function rateLimit(request, env, route, limit=12, windowMs=60000) {
  if (!env.DB) return true;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip + '|' + route));
  const hash = [...new Uint8Array(raw)].map(x=>x.toString(16).padStart(2,'0')).join('');
  const cutoff = Date.now() - windowMs;
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM request_log WHERE ip_hash=? AND route=? AND created_at>?').bind(hash,route,cutoff).first();
  if ((count?.n || 0) >= limit) return false;
  await env.DB.prepare('INSERT INTO request_log (ip_hash,route,created_at) VALUES (?,?,?)').bind(hash,route,Date.now()).run();
  return true;
}
function tokenFromRequest(request){
  const h=request.headers.get('Authorization')||'';
  return h.startsWith('Bearer ')?clean(h.slice(7),120):'';
}
async function getSubscription(request,env){
  const token=tokenFromRequest(request);
  if(!token || !env.DB) return null;
  return await env.DB.prepare("SELECT * FROM subscriptions WHERE access_token=? AND status='active' AND (expires_at IS NULL OR expires_at>?)").bind(token, new Date().toISOString()).first();
}
function calcNutrition(profile){
  const age=Math.max(16,Math.min(90,Number(profile.age)||30));
  const height=Math.max(120,Math.min(230,Number(profile.height)||170));
  const weight=Math.max(35,Math.min(250,Number(profile.weight)||70));
  const sex=profile.sex==='female'?'female':'male';
  const activity={low:1.2,medium:1.45,high:1.65}[profile.activity]||1.45;
  const bmr=sex==='female'?(10*weight+6.25*height-5*age-161):(10*weight+6.25*height-5*age+5);
  let calories=Math.round(bmr*activity/50)*50;
  if(profile.goal==='loss') calories=Math.max(1400,calories-300);
  if(profile.goal==='gain') calories+=250;
  const protein=Math.round(weight*(profile.goal==='gain'?1.6:1.4));
  const days=Math.max(2,Math.min(7,Number(profile.days)||3));
  return {calories,protein,days};
}
const MEALS=[
 {breakfast:['Овсянка с ягодами и йогуртом',420,22],lunch:['Курица с гречкой и овощами',560,48],snack:['Творог с фруктом',220,24],dinner:['Лосось с салатом и картофелем',520,38],training:'Силовая: всё тело'},
 {breakfast:['Омлет с овощами и цельнозерновым хлебом',390,28],lunch:['Индейка с рисом и овощами',570,50],snack:['Яблоко и орехи',230,6],dinner:['Гречка с рыбой и овощами',510,36],training:'Силовая: ноги + корпус'},
 {breakfast:['Йогурт с бананом и овсянкой',400,23],lunch:['Чечевичный суп и цельнозерновой хлеб',520,27],snack:['Творог с ягодами',210,25],dinner:['Курица с киноа и овощами',560,49],training:'Восстановление: ходьба 30 мин'},
 {breakfast:['Творог с ягодами и орехами',410,30],lunch:['Рыба с картофелем и салатом',540,40],snack:['Фрукт и йогурт',190,10],dinner:['Овощное рагу с индейкой',530,45],training:'Силовая: верх тела'},
 {breakfast:['Овсянка с бананом и яйцом',430,23],lunch:['Курица с булгуром и овощами',560,48],snack:['Морковь с хумусом',180,6],dinner:['Рыба с рисом и брокколи',520,38],training:'Интервальная ходьба 25 мин'},
 {breakfast:['Омлет с овощами',380,27],lunch:['Паста с индейкой и овощами',590,47],snack:['Фрукт и творог',210,25],dinner:['Запечённая рыба с овощами',500,40],training:'Силовая: всё тело'},
 {breakfast:['Йогурт с овсянкой, ягодами и семенами',420,24],lunch:['Боул: рис, курица, овощи',570,50],snack:['Яблоко и орехи',230,6],dinner:['Салат с тунцом и цельнозерновым хлебом',490,37],training:'Восстановление: прогулка'}
];
const RECIPE_DB={
 'Овсянка с ягодами и йогуртом':{kcal:420,p:22,ingredients:[['овсянка','60 г'],['греческий йогурт','150 г'],['ягоды','100 г'],['семена чиа','10 г']]},
 'Курица с гречкой и овощами':{kcal:560,p:48,ingredients:[['куриная грудка','160 г'],['гречка сухая','70 г'],['овощи','250 г'],['оливковое масло','10 г']]},
 'Творог с фруктом':{kcal:220,p:24,ingredients:[['творог 5%','150 г'],['яблоко','150 г']]},
 'Лосось с салатом и картофелем':{kcal:520,p:38,ingredients:[['лосось','140 г'],['картофель','220 г'],['салатные овощи','200 г'],['оливковое масло','5 г']]},
 'Омлет с овощами и цельнозерновым хлебом':{kcal:390,p:28,ingredients:[['яйца','2 шт'],['овощи','180 г'],['цельнозерновой хлеб','60 г']]},
 'Индейка с рисом и овощами':{kcal:570,p:50,ingredients:[['филе индейки','160 г'],['рис сухой','75 г'],['овощи','250 г'],['масло','10 г']]},
 'Яблоко и орехи':{kcal:230,p:6,ingredients:[['яблоко','180 г'],['орехи','25 г']]},
 'Гречка с рыбой и овощами':{kcal:510,p:36,ingredients:[['белая рыба','160 г'],['гречка сухая','65 г'],['овощи','250 г']]},
 'Йогурт с бананом и овсянкой':{kcal:400,p:23,ingredients:[['йогурт','200 г'],['банан','120 г'],['овсянка','45 г']]},
 'Чечевичный суп и цельнозерновой хлеб':{kcal:520,p:27,ingredients:[['чечевица сухая','70 г'],['овощи','250 г'],['цельнозерновой хлеб','70 г']]},
 'Творог с ягодами':{kcal:210,p:25,ingredients:[['творог 5%','150 г'],['ягоды','100 г']]},
 'Курица с киноа и овощами':{kcal:560,p:49,ingredients:[['куриная грудка','160 г'],['киноа сухая','65 г'],['овощи','250 г']]},
 'Творог с ягодами и орехами':{kcal:410,p:30,ingredients:[['творог 5%','150 г'],['ягоды','100 г'],['орехи','20 г']]},
 'Рыба с картофелем и салатом':{kcal:540,p:40,ingredients:[['белая рыба','170 г'],['картофель','250 г'],['салатные овощи','200 г']]},
 'Фрукт и йогурт':{kcal:190,p:10,ingredients:[['фрукт','180 г'],['йогурт','150 г']]},
 'Овощное рагу с индейкой':{kcal:530,p:45,ingredients:[['индейка','160 г'],['овощи','350 г'],['масло','10 г']]},
 'Овсянка с бананом и яйцом':{kcal:430,p:23,ingredients:[['овсянка','60 г'],['банан','120 г'],['яйцо','1 шт']]},
 'Курица с булгуром и овощами':{kcal:560,p:48,ingredients:[['курица','160 г'],['булгур сухой','70 г'],['овощи','250 г']]},
 'Морковь с хумусом':{kcal:180,p:6,ingredients:[['морковь','180 г'],['хумус','60 г']]},
 'Рыба с рисом и брокколи':{kcal:520,p:38,ingredients:[['рыба','160 г'],['рис сухой','65 г'],['брокколи','220 г']]},
 'Омлет с овощами':{kcal:380,p:27,ingredients:[['яйца','2 шт'],['овощи','200 г']]},
 'Паста с индейкой и овощами':{kcal:590,p:47,ingredients:[['паста сухая','80 г'],['индейка','160 г'],['овощи','200 г']]},
 'Фрукт и творог':{kcal:210,p:25,ingredients:[['фрукт','150 г'],['творог','150 г']]},
 'Запечённая рыба с овощами':{kcal:500,p:40,ingredients:[['рыба','180 г'],['овощи','350 г'],['масло','5 г']]},
 'Йогурт с овсянкой, ягодами и семенами':{kcal:420,p:24,ingredients:[['йогурт','200 г'],['овсянка','45 г'],['ягоды','100 г'],['семена','10 г']]},
 'Боул: рис, курица, овощи':{kcal:570,p:50,ingredients:[['рис сухой','75 г'],['курица','160 г'],['овощи','250 г']]},
 'Салат с тунцом и цельнозерновым хлебом':{kcal:490,p:37,ingredients:[['тунец','140 г'],['овощи','250 г'],['цельнозерновой хлеб','70 г']]}
};
const SUBS={
 'куриная грудка':['индейка','тофу','белая рыба'],'индейка':['куриная грудка','тофу','чечевица'],'лосось':['форель','скумбрия','тофу'],'рыба':['курица','индейка','нут'],'творог':['греческий йогурт','соевый йогурт'],'рис сухой':['гречка сухая','булгур сухой'],'гречка сухая':['рис сухой','булгур сухой'],'овсянка':['гречневые хлопья','мюсли без сахара'],'йогурт':['кефир','соевый йогурт']
};
function enrichWeek(week){
  return week.map(day=>{const meals=Object.entries(day.meals).map(([type,name])=>{const r=RECIPE_DB[name]||{kcal:0,p:0,ingredients:[]};return {type,name,kcal:r.kcal,protein:r.p,ingredients:r.ingredients}});return {...day,meals};});
}
function shoppingList(week){const map={}; for(const day of week) for(const meal of day.meals) for(const [item,qty] of meal.ingredients){const k=item; map[k]=(map[k]||[]); map[k].push(qty);} return Object.entries(map).map(([item,parts])=>({item,amount:[...new Set(parts)].join(' + ')}));}
function weeklyPlan(profile){
  const n=calcNutrition(profile); const goal=profile.goal==='loss'?'умеренный дефицит':profile.goal==='gain'?'небольшой профицит':'поддержание';
  const trainingDays=Math.max(2,Math.min(7,Number(profile.days)||3)); const week=[];
  for(let i=0;i<7;i++){const base=MEALS[i]; const train=i<trainingDays; const kind=profile.training==='gym'?'зал':profile.training==='mixed'?(i%2?'зал':'дом'):'дом';
    week.push({day:i+1,training:train?(kind==='зал'?'Силовая: ноги + корпус':'Силовая: всё тело'):'Восстановление: 20–30 мин ходьбы',meals:{breakfast:base.breakfast[0],lunch:base.lunch[0],snack:base.snack[0],dinner:base.dinner[0]}});
  }
  const enriched=enrichWeek(week); const total=enriched.flatMap(d=>d.meals).reduce((a,m)=>({kcal:a.kcal+m.kcal,protein:a.protein+m.protein}),{kcal:0,protein:0});
  return {calories:n.calories,protein:n.protein,days:trainingDays,goal,week:enriched,shopping:shoppingList(enriched),substitutions:SUBS,averageDaily:{kcal:Math.round(total.kcal/7),protein:Math.round(total.protein/7)}};
}
async function progressApi(request,env){
  const sub=await getSubscription(request,env); if(!sub||!env.DB) return json({error:'Нужна активная подписка.'},403);
  if(request.method==='GET'){const rows=await env.DB.prepare('SELECT * FROM progress WHERE access_token=? ORDER BY date DESC LIMIT 30').bind(sub.access_token).all();return json({items:rows.results||[]});}
  const b=await request.json(); const date=clean(b.date,20)||new Date().toISOString().slice(0,10); const weight=Number(b.weight); const completedMeal=Number(b.completed_meal)||0; const completedWorkout=Number(b.completed_workout)||0; const note=clean(b.note,300);
  if(!Number.isFinite(weight)||weight<35||weight>250) return json({error:'Укажите корректный вес.'},400);
  await env.DB.prepare(`INSERT INTO progress(access_token,date,weight,completed_meal,completed_workout,note) VALUES(?,?,?,?,?,?) ON CONFLICT(access_token,date) DO UPDATE SET weight=excluded.weight,completed_meal=excluded.completed_meal,completed_workout=excluded.completed_workout,note=excluded.note`).bind(sub.access_token,date,weight,completedMeal,completedWorkout,note).run();
  const rows=await env.DB.prepare('SELECT weight FROM progress WHERE access_token=? ORDER BY date ASC').bind(sub.access_token).all(); const vals=(rows.results||[]).map(x=>Number(x.weight)).filter(Boolean); const trend=vals.length>1?Number((vals.at(-1)-vals[0]).toFixed(1)):0;
  return json({ok:true,trend,latest:weight});
}
async function profileApi(request,env){
  const sub=await getSubscription(request,env);
  if(!sub || !env.DB) return json({error:'Персональный профиль доступен после активации подписки.'},403);
  if(request.method==='GET'){
    const row=await env.DB.prepare('SELECT profile_json FROM profiles WHERE access_token=?').bind(sub.access_token).first();
    return json({profile:row?JSON.parse(row.profile_json):null});
  }
  const body=await request.json();
  const profile={name:clean(body.name,80),sex:clean(body.sex,10),age:Number(body.age),height:Number(body.height),weight:Number(body.weight),activity:clean(body.activity,20),goal:clean(body.goal,20),training:clean(body.training,20),days:Number(body.days),preferences:clean(body.preferences,500)};
  if(profile.age<16||profile.height<120||profile.weight<35||profile.weight>250) return json({error:'Проверьте возраст, рост и вес.'},400);
  const now=new Date().toISOString(), pj=JSON.stringify(profile), plan=weeklyPlan(profile);
  await env.DB.prepare('INSERT INTO profiles (access_token,profile_json,updated_at) VALUES (?,?,?) ON CONFLICT(access_token) DO UPDATE SET profile_json=excluded.profile_json,updated_at=excluded.updated_at').bind(sub.access_token,pj,now).run();
  await env.DB.prepare('INSERT INTO weekly_plans (id,access_token,plan_json,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET plan_json=excluded.plan_json,updated_at=excluded.updated_at').bind(sub.access_token,sub.access_token,JSON.stringify(plan),now,now).run();
  return json({profile,plan});
}
async function personalizedPlan(request,env){
  const sub=await getSubscription(request,env);
  if(!sub || !env.DB) return json({error:'Персональный план доступен после активации подписки.'},403);
  const row=await env.DB.prepare('SELECT plan_json FROM weekly_plans WHERE access_token=?').bind(sub.access_token).first();
  if(row) return json({plan:JSON.parse(row.plan_json)});
  const pr=await env.DB.prepare('SELECT profile_json FROM profiles WHERE access_token=?').bind(sub.access_token).first();
  if(!pr) return json({error:'Сначала заполните профиль.'},404);
  const plan=weeklyPlan(JSON.parse(pr.profile_json));
  return json({plan});
}

async function chat(request, env) {
  if (!(await rateLimit(request, env, 'chat', 20, 60000))) return json({error:'Слишком много запросов. Попробуйте через минуту.'},429);
  const body = await request.json();
  const message = clean(body?.message,2000);
  if (!message) return json({error:'Пустой вопрос'},400);
  if (!env.AI) return json({error:'AI binding is not configured'},503);
  let profileContext='Профиль пользователя не заполнен.';
  const sub=await getSubscription(request,env);
  if(sub && env.DB){
    const row=await env.DB.prepare('SELECT profile_json FROM profiles WHERE access_token=?').bind(sub.access_token).first();
    if(row) profileContext=clean(row.profile_json,1800);
  }
  const prompt = `Ты Fital AI — помощник сервиса Fital Pro по питанию и фитнесу. Отвечай на русском кратко, доброжелательно и практично. Учитывай профиль пользователя, если он указан. Не ставь диагнозы, не назначай лекарства и не заменяй врача. Не обещай медицинский результат. Если вопрос требует медицинской оценки — рекомендуй обратиться к врачу. Профиль: ${profileContext}. Вопрос: ${message}`;
  const result = await env.AI.run(MODEL,{prompt,max_tokens:500});
  const reply = result?.response || result?.result?.response;
  if (!reply) return json({error:'AI не вернул ответ'},502);
  return json({reply:String(reply).trim()});
}

async function lead(request, env) {
  if (!(await rateLimit(request, env, 'lead', 5, 3600000))) return json({error:'Слишком много заявок с этого устройства.'},429);
  const body = await request.json();
  const name=clean(body?.name,120), contact=clean(body?.contact,160), goal=clean(body?.goal,120), plan=clean(body?.plan,120);
  if (!name || !contact) return json({error:'Заполните имя и контакт'},400);
  const id=crypto.randomUUID(), createdAt=new Date().toISOString();
  if (env.DB) await env.DB.prepare('INSERT INTO leads (id,name,contact,goal,plan,created_at) VALUES (?,?,?,?,?,?)').bind(id,name,contact,goal,plan,createdAt).run();
  return json({ok:true,id});
}

async function checkout(request, env) {
  if (!(await rateLimit(request, env, 'checkout', 8, 3600000))) return json({error:'Слишком много попыток оплаты. Попробуйте позже.'},429);
  if (!env.YOOKASSA_SHOP_ID || !env.YOOKASSA_SECRET_KEY) return json({error:'Оплата пока не активирована: ключи ЮKassa не настроены.'},503);
  const body=await request.json(); const plan=clean(body?.plan,40); const customer=clean(body?.contact,160); const clientRef=clean(body?.client_ref,80) || crypto.randomUUID(); const p=PLANS[plan];
  if (!p) return json({error:'Неизвестный тариф'},400);
  const origin=new URL(request.url).origin;
  const auth=btoa(`${env.YOOKASSA_SHOP_ID}:${env.YOOKASSA_SECRET_KEY}`);
  const r=await fetch('https://api.yookassa.ru/v3/payments',{method:'POST',headers:{Authorization:`Basic ${auth}`,'Idempotence-Key':crypto.randomUUID(),'Content-Type':'application/json'},body:JSON.stringify({amount:{value:p.amount,currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:`${origin}/?payment_ref=${encodeURIComponent(clientRef)}&plan=${encodeURIComponent(plan)}`},description:p.label,metadata:{plan,customer,client_ref:clientRef}})});
  const data=await r.json(); if(!r.ok) return json({error:'ЮKassa отклонила запрос'},502);
  if(!data?.confirmation?.confirmation_url) return json({error:'Не получена ссылка на оплату'},502);
  return json({ok:true,payment_id:data.id,confirmation_url:data.confirmation.confirmation_url});
}

async function yooWebhook(request, env) {
  const event=await request.json();
  const obj=event?.object || {};
  const paymentId=clean(obj?.id,100);
  if (!paymentId) return json({ok:true});
  let verified=obj;
  if (env.YOOKASSA_SHOP_ID && env.YOOKASSA_SECRET_KEY) {
    const auth=btoa(`${env.YOOKASSA_SHOP_ID}:${env.YOOKASSA_SECRET_KEY}`);
    const vr=await fetch(`https://api.yookassa.ru/v3/payments/${encodeURIComponent(paymentId)}`,{headers:{Authorization:`Basic ${auth}`}});
    if (!vr.ok) return json({error:'Не удалось проверить платёж'},502);
    verified=await vr.json();
  }
  const status=clean(verified?.status || event?.event,60);
  const plan=clean(verified?.metadata?.plan,40);
  const contact=clean(verified?.metadata?.customer,160);
  const clientRef=clean(verified?.metadata?.client_ref,80);
  const now=new Date().toISOString();
  if (env.DB) {
    await env.DB.prepare(`INSERT INTO payments (id,status,plan,amount,currency,created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,plan=excluded.plan,amount=excluded.amount,currency=excluded.currency`).bind(paymentId,status,plan,verified?.amount?.value || null,verified?.amount?.currency || 'RUB',now).run();
    if (status==='succeeded') {
      const existing=await env.DB.prepare('SELECT access_token FROM subscriptions WHERE payment_id=?').bind(paymentId).first();
      const token=existing?.access_token || crypto.randomUUID().replaceAll('-','');
      const expiresAt=new Date(Date.now()+30*24*60*60*1000).toISOString();
      await env.DB.prepare(`INSERT INTO subscriptions (id,payment_id,client_ref,plan,status,access_token,customer_contact,created_at,updated_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(payment_id) DO UPDATE SET status=excluded.status,plan=excluded.plan,client_ref=excluded.client_ref,updated_at=excluded.updated_at,expires_at=excluded.expires_at`).bind(crypto.randomUUID(),paymentId,clientRef,plan,'active',token,contact,now,now,expiresAt).run();
    }
  }
  return json({ok:true});
}

async function paymentStatus(request, env) {
  const url=new URL(request.url);
  const id=clean(url.searchParams.get('id'),100);
  const clientRef=clean(url.searchParams.get('ref'),80);
  const token=tokenFromRequest(request);
  if (!env.DB) return json({status:'unknown'},503);
  if (token) {
    const row=await env.DB.prepare('SELECT plan,status,access_token,customer_contact,created_at,updated_at,expires_at FROM subscriptions WHERE access_token=?').bind(token).first();
    if (!row) return json({error:'Недействительный токен доступа'},401);
    return json({status:row.status,plan:row.plan,access_token:row.access_token,customer_contact:row.customer_contact,created_at:row.created_at,updated_at:row.updated_at});
  }
  if (!id && !clientRef) return json({status:'unknown'},400);
  const row=clientRef ? await env.DB.prepare('SELECT payment_id,plan,status,access_token,updated_at,expires_at FROM subscriptions WHERE client_ref=?').bind(clientRef).first() : await env.DB.prepare('SELECT payment_id,plan,status,access_token,updated_at,expires_at FROM subscriptions WHERE payment_id=?').bind(id).first();
  if (row) {
    if (row.status==='active') return json({status:row.status,plan:row.plan,access_token:row.access_token,updated_at:row.updated_at,expires_at:row.expires_at});
    return json({status:row.status,plan:row.plan,updated_at:row.updated_at});
  }
  const payment= id ? await env.DB.prepare('SELECT id,status,plan,amount,currency FROM payments WHERE id=?').bind(id).first() : null;
  return payment ? json({status:payment.status,plan:payment.plan,amount:payment.amount,currency:payment.currency}) : json({status:'pending'});
}

async function me(request, env) {
  const token=tokenFromRequest(request);
  if (!token || !env.DB) return json({error:'Требуется токен доступа'},401);
  const row=await env.DB.prepare('SELECT plan,status,access_token,customer_contact,created_at,updated_at,expires_at FROM subscriptions WHERE access_token=?').bind(token).first();
  if (!row) return json({error:'Недействительный токен доступа'},401);
  return json({ok:true,subscription:row});
}

export default { async fetch(request, env) {
  const url=new URL(request.url);
  try {
    if (url.pathname==='/health' && request.method==='GET') return json({ok:true,service:'Fital Pro',ai:!!env.AI,db:!!env.DB,payments:!!(env.YOOKASSA_SHOP_ID&&env.YOOKASSA_SECRET_KEY)});
    if (url.pathname==='/api/chat' && request.method==='POST') return await chat(request,env);
    if (url.pathname==='/api/profile' && (request.method==='GET'||request.method==='POST')) return await profileApi(request,env);
    if (url.pathname==='/api/plan' && request.method==='GET') return await personalizedPlan(request,env);
    if (url.pathname==='/api/progress' && (request.method==='GET'||request.method==='POST')) return await progressApi(request,env);
    if (url.pathname==='/api/lead' && request.method==='POST') return await lead(request,env);
    if (url.pathname==='/api/checkout' && request.method==='POST') return await checkout(request,env);
    if (url.pathname==='/webhooks/yookassa' && request.method==='POST') return await yooWebhook(request,env);
    if (url.pathname==='/api/payment-status' && request.method==='GET') return await paymentStatus(request,env);
    if (url.pathname==='/api/me' && request.method==='GET') return await me(request,env);
    return env.ASSETS.fetch(request);
  } catch (e) { return json({error:'Внутренняя ошибка сервиса'},500); }
}};
