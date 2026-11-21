const $ = (selector) => document.querySelector(selector);
const TOKEN_KEY = 'fitalpro_access_token';
const REF_KEY = 'fitalpro_payment_ref';
const prices = { 'Питание': '990 ₽', 'PRO': '1 990 ₽', 'Premium': '3 990 ₽' };
let selectedPlan = 'PRO';
let checkoutData = null;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, function (char) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char];
  });
}

function showToast(message) {
  const box = $('#toast');
  box.textContent = message;
  box.classList.add('show');
  window.setTimeout(function () { box.classList.remove('show'); }, 2800);
}

async function api(path, options) {
  const config = options || {};
  config.headers = config.headers || {};
  if (config.body && !config.headers['Content-Type']) config.headers['Content-Type'] = 'application/json';
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = 'Bearer ' + token;
  const response = await fetch(path, config);
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) throw new Error(data.error || 'Не удалось выполнить запрос.');
  return data;
}

function choosePlan(plan) {
  if (!prices[plan]) return;
  selectedPlan = plan;
  $('#selectedPlanLabel').textContent = plan;
  document.querySelectorAll('[data-card-plan]').forEach(function (card) {
    card.classList.toggle('selected', card.getAttribute('data-card-plan') === plan);
  });
}

document.querySelectorAll('[data-plan]').forEach(function (button) {
  button.addEventListener('click', function () {
    choosePlan(button.getAttribute('data-plan'));
    $('#questionnaire').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

$('#intakeForm').addEventListener('submit', async function (event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $('#generateButton');
  const errorBox = $('#formError');
  errorBox.textContent = '';
  button.disabled = true;
  button.textContent = 'ИИ составляет ваш план…';
  const fields = new FormData(form);
  const profile = {
    name: fields.get('name'),
    sex: fields.get('sex'),
    age: Number(fields.get('age')),
    height: Number(fields.get('height')),
    weight: Number(fields.get('weight')),
    activity: fields.get('activity'),
    goal: fields.get('goal'),
    training: fields.get('training'),
    days: Number(fields.get('days')),
    preferences: fields.get('preferences')
  };
  try {
    checkoutData = await api('/api/checkout', {
      method: 'POST',
      body: JSON.stringify({ plan: selectedPlan, contact: fields.get('contact'), profile: profile })
    });
    $('#previewCalories').textContent = Number(checkoutData.preview.calories).toLocaleString('ru-RU');
    $('#previewProtein').textContent = String(checkoutData.preview.protein);
    $('#previewDayTitle').textContent = checkoutData.preview.firstDay.day;
    const day = checkoutData.preview.firstDay;
    const mealLabels = [['Завтрак', day.breakfast], ['Обед', day.lunch], ['Перекус', day.snack], ['Ужин', day.dinner]];
    $('#previewMeals').innerHTML = mealLabels.map(function (meal) {
      return '<div class="preview-meal"><small>' + meal[0] + '</small><strong>' + escapeHtml(meal[1]) + '</strong></div>';
    }).join('');
    $('#previewWorkout').textContent = day.workout;
    $('#previewDescription').textContent = selectedPlan === 'Питание'
      ? 'Полное меню на неделю, список покупок и рекомендации на 7 дней.'
      : 'Полное меню, программа активности и доступ к ИИ-консультанту на ' + checkoutData.preview.durationDays + ' дней.';
    $('#paymentButton').textContent = 'Оплатить ' + prices[selectedPlan] + ' ↗';
    $('#planPreview').classList.remove('is-hidden');
    $('#planPreview').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    errorBox.textContent = error.message;
  } finally {
    button.disabled = false;
    button.innerHTML = 'Создать мой план с ИИ <span>↗</span>';
  }
});

$('#paymentButton').addEventListener('click', function () {
  const errorBox = $('#paymentError');
  errorBox.textContent = '';
  if (!checkoutData || !checkoutData.confirmation_url) {
    errorBox.textContent = 'Сначала заполните анкету и создайте персональный план.';
    return;
  }
  localStorage.setItem(REF_KEY, checkoutData.client_ref);
  window.location.href = checkoutData.confirmation_url;
});

function renderFullPlan(plan) {
  const days = Array.isArray(plan.week) ? plan.week : [];
  $('#fullPlan').innerHTML = days.map(function (day) {
    return '<article class="day-card">' +
      '<h3>' + escapeHtml(day.day) + '</h3>' +
      '<p><strong>Завтрак</strong> · ' + escapeHtml(day.breakfast) + '</p>' +
      '<p><strong>Обед</strong> · ' + escapeHtml(day.lunch) + '</p>' +
      '<p><strong>Перекус</strong> · ' + escapeHtml(day.snack) + '</p>' +
      '<p><strong>Ужин</strong> · ' + escapeHtml(day.dinner) + '</p>' +
      '<p class="day-workout"><strong>Активность</strong><br>' + escapeHtml(day.workout) + '</p>' +
      '</article>';
  }).join('');
  if (plan.shopping && plan.shopping.length) {
    $('#fullPlan').insertAdjacentHTML('beforeend',
      '<article class="day-card"><h3>Список покупок</h3><p>' +
      plan.shopping.map(escapeHtml).join('</p><p>') + '</p></article>');
  }
  if (plan.tips && plan.tips.length) {
    $('#fullPlan').insertAdjacentHTML('beforeend',
      '<article class="day-card"><h3>Рекомендации</h3><p>' +
      plan.tips.map(escapeHtml).join('</p><p>') + '</p></article>');
  }
}

async function loadAccount() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return false;
  try {
    const [me, planData] = await Promise.all([api('/api/me'), api('/api/plan')]);
    const subscription = me.subscription || {};
    $('#accountPlanName').textContent = 'Тариф ' + (subscription.plan || 'Fital Pro');
    $('#accountExpiry').textContent = subscription.expires_at
      ? 'Доступ до ' + new Date(subscription.expires_at).toLocaleDateString('ru-RU')
      : 'Подписка активна';
    $('#accountStatus').textContent = '● Подписка активна';
    renderFullPlan(planData.plan);
    $('#account').classList.remove('is-hidden');
    return true;
  } catch {
    localStorage.removeItem(TOKEN_KEY);
    return false;
  }
}

async function checkPayment(reference) {
  if (!reference) return;
  $('#planPreview').classList.add('is-hidden');
  $('#account').classList.add('is-hidden');
  showToast('Проверяем подтверждение оплаты…');
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const result = await api('/api/payment-status?ref=' + encodeURIComponent(reference), { method: 'GET' });
      if (result.status === 'active' && result.access_token) {
        localStorage.setItem(TOKEN_KEY, result.access_token);
        localStorage.removeItem(REF_KEY);
        history.replaceState({}, '', '/');
        showToast('Оплата подтверждена. Доступ открыт!');
        await loadAccount();
        $('#account').scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
    } catch {}
    await new Promise(function (resolve) { window.setTimeout(resolve, 2500); });
  }
  showToast('Платёж ещё обрабатывается. Личный кабинет обновится после подтверждения.');
}

$('#reloadPlan').addEventListener('click', async function () {
  try {
    const data = await api('/api/plan');
    renderFullPlan(data.plan);
    showToast('План обновлён.');
  } catch (error) {
    showToast(error.message);
  }
});

$('#progressForm').addEventListener('submit', async function (event) {
  event.preventDefault();
  const fields = new FormData(event.currentTarget);
  try {
    await api('/api/progress', {
      method: 'POST',
      body: JSON.stringify({
        weight: Number(fields.get('weight')),
        completed_meal: fields.get('completed_meal') === 'on',
        completed_workout: fields.get('completed_workout') === 'on'
      })
    });
    $('#progressMessage').textContent = 'Запись сохранена.';
    event.currentTarget.reset();
  } catch (error) {
    $('#progressMessage').textContent = error.message;
  }
});

$('#chatForm').addEventListener('submit', async function (event) {
  event.preventDefault();
  const input = event.currentTarget.elements.message;
  const reply = $('#chatReply');
  reply.textContent = 'Fital AI готовит ответ…';
  try {
    const data = await api('/api/chat', { method: 'POST', body: JSON.stringify({ message: input.value }) });
    reply.textContent = data.reply || 'Ответ не получен.';
    input.value = '';
  } catch (error) {
    reply.textContent = error.message;
  }
});

(async function init() {
  choosePlan('PRO');
  const params = new URLSearchParams(window.location.search);
  if (params.get('payment') === 'fail') {
    localStorage.removeItem(REF_KEY);
    showToast('Платёж не завершён. Вы можете попробовать ещё раз.');
    history.replaceState({}, '', '/');
    await loadAccount();
    return;
  }
  const ref = params.get('ref') || params.get('Shp_ref') || localStorage.getItem(REF_KEY);
  // Robokassa may return to the configured SuccessURL without query parameters.
  // The pending reference is already stored locally before redirecting to checkout.
  if (ref) {
    await checkPayment(ref);
    return;
  }
  await loadAccount();
})();