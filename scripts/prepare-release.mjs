import { readFile, writeFile, mkdir } from 'node:fs/promises';

const appPath='public/app.js';
const htmlPath='public/index.html';
let app=await readFile(appPath,'utf8');
let html=await readFile(htmlPath,'utf8');

function replaceSection(source,startMarker,endMarker,replacement,label){
  const start=source.indexOf(startMarker);
  const end=source.indexOf(endMarker,start+startMarker.length);
  if(start<0||end<0||end<=start) throw new Error('Cannot safely patch '+label+'; source markers missing.');
  return source.slice(0,start)+replacement+'\n\n'+source.slice(end);
}

const checkout = String.raw`// Checkout is available only after a server-generated AI plan has been prepared.
document.querySelectorAll('[data-checkout]').forEach(btn => btn.addEventListener('click', async () => {
  const draftId = localStorage.getItem('fitalpro_plan_draft') || '';
  if (!draftId) {
    alert('Сначала заполните анкету и получите персональный план.');
    document.getElementById('profile')?.scrollIntoView({behavior:'smooth'});
    return;
  }
  const plan = btn.dataset.checkout;
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Создаём оплату…';
  try {
    const r = await fetch('/api/checkout', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({plan, draft_id:draftId})
    });
    const data = await r.json();
    if (!r.ok || !data.confirmation_url) throw new Error(data.error || 'Не удалось создать оплату');
    window.location.href = data.confirmation_url;
  } catch (e) {
    alert(e.message || 'Оплата пока недоступна.');
    btn.disabled = false;
    btn.textContent = original;
  }
}));`;

const paymentReturn = String.raw`// Robokassa returns InvId and the signed Shp_client_ref custom parameter.
(async function handlePaymentReturn(){
  const params = new URLSearchParams(location.search);
  const payment = params.get('InvId') || params.get('payment_id');
  const paymentRef = params.get('Shp_client_ref') || params.get('payment_ref');
  const result = document.getElementById('paymentResult');
  if ((!payment && !paymentRef) || !result) return;
  result.hidden = false;
  const title = document.getElementById('paymentTitle');
  const message = document.getElementById('paymentText');
  const access = document.getElementById('paymentAccess');
  for (let i = 0; i < 12; i++) {
    try {
      const query = paymentRef ? 'ref=' + encodeURIComponent(paymentRef) : 'id=' + encodeURIComponent(payment);
      const r = await fetch('/api/payment-status?' + query, {cache:'no-store'});
      const d = await r.json();
      if (d.status === 'active' && d.access_token) {
        localStorage.setItem('fitalpro_access_token', d.access_token);
        localStorage.removeItem('fitalpro_plan_draft');
        title.textContent = 'Оплата подтверждена ✓';
        message.textContent = 'Тариф активирован. Открываем ваш персональный кабинет…';
        if (access) access.hidden = false;
        history.replaceState({}, '', location.pathname + '#member');
        setTimeout(() => location.reload(), 500);
        return;
      }
      title.textContent = 'Платёж обрабатывается';
      message.textContent = 'Ожидаем серверное подтверждение Robokassa. Не закрывайте страницу.';
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 2500));
  }
  title.textContent = 'Подтверждение ещё выполняется';
  message.textContent = 'Если оплата прошла, обновите страницу через минуту. Доступ выдаётся только после серверного подтверждения.';
})();`;

const profile = String.raw`// Questionnaire and AI plan preview. The server stores the draft; access is activated only after payment.
(function profileModule(){
  const form = document.getElementById('profileForm');
  const note = document.getElementById('profileNote');
  const card = document.getElementById('planCard');
  if (!form) return;
  const token = () => localStorage.getItem('fitalpro_access_token') || '';
  const localKey = 'fitalpro_profile';

  try {
    const saved = JSON.parse(localStorage.getItem(localKey) || 'null');
    if (saved) Object.entries(saved).forEach(([k,v]) => { const el=form.elements[k]; if(el) el.value=v; });
  } catch (_) {}

  const render = (data) => {
    if (!data?.plan || !card) return;
    const plan = data.plan;
    card.hidden = false;
    document.getElementById('planCalories').textContent = plan.calories + ' ккал';
    document.getElementById('planProtein').textContent = plan.protein + ' г';
    document.getElementById('planDays').textContent = plan.days + '× / нед.';
    const list = document.getElementById('planList');
    list.replaceChildren();
    [
      'Цель: ' + (plan.goal || '—'),
      'Средняя дневная калорийность меню: ' + (plan.averageDaily?.kcal || plan.calories) + ' ккал',
      'Средний белок: ' + (plan.averageDaily?.protein || plan.protein) + ' г'
    ].forEach(value => { const li=document.createElement('li'); li.textContent=value; list.appendChild(li); });
    const week = document.getElementById('weekPlan');
    if (week && Array.isArray(plan.week)) {
      const heading = document.createElement('h4');
      heading.textContent = 'План на 7 дней';
      week.replaceChildren(heading);
      plan.week.forEach(day => {
        const article = document.createElement('article');
        article.className = 'day-plan';
        const title = document.createElement('b');
        title.textContent = 'День ' + day.day;
        const training = document.createElement('span');
        training.textContent = day.training || 'Восстановление';
        const meals = document.createElement('p');
        meals.textContent = (day.meals || []).map(meal => meal.name).join(' • ');
        article.append(title, training, meals);
        week.appendChild(article);
      });
    }
    window.dispatchEvent(new CustomEvent('fital:plan-updated', {detail:plan}));
  };

  async function loadPaidProfile(){
    if (!token()) return;
    const headers = {Authorization:'Bearer ' + token()};
    const r = await fetch('/api/profile', {headers, cache:'no-store'});
    if (r.ok) {
      const data = await r.json();
      if (data.profile) Object.entries(data.profile).forEach(([k,v]) => { const el=form.elements[k]; if(el) el.value=v; });
    }
    const planResponse = await fetch('/api/plan', {headers, cache:'no-store'});
    if (planResponse.ok) render(await planResponse.json());
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    for (const key of ['age','height','weight','days']) data[key] = Number(data[key]);
    localStorage.setItem(localKey, JSON.stringify(data));
    const button = form.querySelector('button[type="submit"]');
    const original = button?.textContent || 'Сохранить профиль и получить план';
    if (button) { button.disabled=true; button.textContent='ИИ составляет персональный план…'; }
    note.textContent = 'Проверяем анкету и формируем меню и тренировки…';
    try {
      if (token()) {
        const r = await fetch('/api/profile', {
          method:'POST',
          headers:{'Content-Type':'application/json', Authorization:'Bearer '+token()},
          body:JSON.stringify(data)
        });
        const result = await r.json();
        if (!r.ok) throw new Error(result.error || 'Не удалось обновить профиль');
        render(result);
        note.textContent = 'Профиль и персональный план обновлены.';
      } else {
        const r = await fetch('/api/plan-preview', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify(data)
        });
        const result = await r.json();
        if (!r.ok || !result.draft_id || !result.plan) throw new Error(result.error || 'Не удалось сформировать план');
        localStorage.setItem('fitalpro_plan_draft', result.draft_id);
        render(result);
        note.textContent = 'Персональный план готов. Теперь выберите тариф и нажмите «Оплатить».';
      }
    } catch (error) {
      note.textContent = error.message || 'Не удалось сформировать план. Попробуйте ещё раз.';
    } finally {
      if (button) { button.disabled=false; button.textContent=original; }
    }
  });

  loadPaidProfile().catch(() => {});
})();`;

app=replaceSection(app,'// Real checkout:','// Payment return page:',checkout,'checkout');
app=replaceSection(app,'// Payment return page:','// Member access:',paymentReturn,'payment return');
app=replaceSection(app,'// Personal profile and plan.','// Fital Pro dashboard:',profile,'profile module');

if(!app.includes('/api/plan-preview')||!app.includes("params.get('Shp_client_ref')")||!app.includes('fitalpro_plan_draft')) {
  throw new Error('Frontend flow checks failed.');
}
const newAge='name="age" type="number" min="18" max="80"';
if(html.includes('name="age" type="number" min="16" max="90"')) {
  html=html.replace('name="age" type="number" min="16" max="90"',newAge);
} else if(!html.includes(newAge)) {
  throw new Error('Questionnaire age input could not be safely updated.');
}

await writeFile(appPath,app,'utf8');
await writeFile(htmlPath,html,'utf8');
await mkdir('migrations',{recursive:true});
await writeFile('migrations/0007_plan_drafts.sql',[
  'ALTER TABLE payments ADD COLUMN client_ref TEXT;',
  'ALTER TABLE payments ADD COLUMN draft_id TEXT;',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_client_ref ON payments(client_ref);',
  '',
  'CREATE TABLE IF NOT EXISTS plan_drafts (',
  '  id TEXT PRIMARY KEY,',
  '  profile_json TEXT NOT NULL,',
  '  plan_json TEXT NOT NULL,',
  '  created_at TEXT NOT NULL',
  ');',
  'CREATE INDEX IF NOT EXISTS idx_plan_drafts_created ON plan_drafts(created_at);',
  ''
].join('\n'),'utf8');
console.log('Prepared Fital Pro questionnaire-first AI plan flow and D1 migration 0007.');
