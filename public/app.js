const $ = (selector) => document.querySelector(selector);
const TOKEN_KEY = 'fitalpro_access_token';
const REF_KEY = 'fitalpro_payment_ref';
const prices = { 'Питание': '990 ₽', 'PRO': '1 990 ₽', 'Premium': '3 990 ₽' };
let selectedPlan = 'PRO';
let checkoutData = null;
let intakeRevision = 0;

function syncTrainingFields(form, plan) {
  if (!form) return;
  const showTraining = plan !== 'Питание';
  form.querySelectorAll('[data-training-field]').forEach(function (field) {
    field.classList.toggle('is-hidden', !showTraining);
    field.querySelectorAll('select, input').forEach(function (control) {
      control.required = showTraining;
    });
  });
}

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
  if (!response.ok) {
    const error = new Error(data.error || 'Не удалось выполнить запрос.');
    error.status = response.status;
    throw error;
  }
  return data;
}

function invalidateCheckout(showMessage = true) {
  intakeRevision++;
  if (checkoutData) {
    checkoutData = null;
    $('#planPreview').classList.add('is-hidden');
    $('#paymentError').textContent = '';
    if (showMessage) {
      $('#formError').textContent = 'Анкета или тариф изменились. Создайте персональный план повторно перед оплатой.';
    }
  }
  return intakeRevision;
}

function choosePlan(plan) {
  if (!prices[plan]) return;
  if (selectedPlan !== plan) invalidateCheckout();
  selectedPlan = plan;
  syncTrainingFields($('#intakeForm'), plan);
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

const intakeForm = $('#intakeForm');
['input', 'change'].forEach(function (eventName) {
  intakeForm.addEventListener(eventName, invalidateCheckout);
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
  const requestPlan = selectedPlan;
  const requestRevision = invalidateCheckout(false);
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
    const generatedCheckout = await api('/api/checkout', {
      method: 'POST',
      body: JSON.stringify({ plan: requestPlan, contact: fields.get('contact'), profile: profile, pd_consent: fields.get('pd_consent') === 'on', offer_accepted: fields.get('offer_accepted') === 'on' })
    });
    if (requestRevision !== intakeRevision || requestPlan !== selectedPlan) {
      errorBox.textContent = 'Анкета или тариф изменились во время генерации. Создайте план повторно.';
      return;
    }
    checkoutData = generatedCheckout;
    $('#previewCalories').textContent = Number(checkoutData.preview.calories).toLocaleString('ru-RU');
    $('#previewProtein').textContent = String(checkoutData.preview.protein);
    $('#previewFat').textContent = String(checkoutData.preview.fat);
    $('#previewCarbs').textContent = String(checkoutData.preview.carbs);
    $('#previewDayTitle').textContent = checkoutData.preview.firstDay.day;
    const day = checkoutData.preview.firstDay;
    const mealLabels = [['Завтрак', 'breakfast'], ['Обед', 'lunch'], ['Перекус', 'snack'], ['Ужин', 'dinner']];
    $('#previewMeals').innerHTML = mealLabels.map(function (meal) {
      const ingredients = Array.isArray(day[meal[1] + 'Ingredients']) ? day[meal[1] + 'Ingredients'] : [];
      const composition = ingredients.map(item => escapeHtml(item.name) + ' — ' + Number(item.grams).toLocaleString('ru-RU') + ' г').join(' · ');
      return '<div class="preview-meal"><small>' + meal[0] + '</small><strong>' + escapeHtml(day[meal[1]]) + '</strong>' +
        (composition ? '<small>Состав: ' + composition + '</small>' : '') +
        (day[meal[1] + 'Recipe'] ? '<small>Приготовление: ' + escapeHtml(day[meal[1] + 'Recipe']) + '</small>' : '') + '</div>';
    }).join('');
    const actual = day.nutrition || {};
    $('#previewDayNutrition').textContent = 'Первый день по составу продуктов: ' +
      Number(actual.calories || 0).toLocaleString('ru-RU') + ' ккал · ' +
      Number(actual.protein || 0).toLocaleString('ru-RU') + ' г белка · ' +
      Number(actual.fat || 0).toLocaleString('ru-RU') + ' г жиров · ' +
      Number(actual.carbs || 0).toLocaleString('ru-RU') + ' г углеводов.';
    $('#previewWorkout').textContent = day.workout;
    $('#previewDescription').textContent = requestPlan === 'Питание'
      ? 'Меню на 7 дней, список покупок и сохранение программы в личном кабинете.'
      : requestPlan === 'Premium'
        ? 'Меню и тренировки на 30 дней, доступ на 30 дней и еженедельный ИИ-разбор.'
        : 'Меню и тренировки на 14 дней, доступ к ИИ-консультанту и дневнику прогресса.';
    $('#paymentButton').textContent = 'Оплатить ' + prices[requestPlan] + ' ↗';
    $('#planPreview').classList.remove('is-hidden');
    $('#planPreview').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    if (requestRevision === intakeRevision) errorBox.textContent = error.message;
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

function renderProgressHistory(items) {
  const container = $('#progressHistory');
  if (!container) return;
  if (!Array.isArray(items) || !items.length) {
    container.innerHTML = '<p class="progress-empty">Записей пока нет. Сохраните первый результат выше.</p>';
    return;
  }
  container.innerHTML = items.slice(0, 10).map(function (item) {
    const rawDate = String(item.date || '');
    const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
      ? new Date(rawDate + 'T00:00:00')
      : null;
    const dateLabel = parsedDate && !Number.isNaN(parsedDate.getTime())
      ? parsedDate.toLocaleDateString('ru-RU')
      : escapeHtml(rawDate || 'Дата не указана');
    const weight = Number(item.weight);
    const meal = Number(item.completed_meal) === 1 ? 'питание отмечено' : 'питание не отмечено';
    const workout = Number(item.completed_workout) === 1 ? 'тренировка отмечена' : 'тренировка не отмечена';
    return '<article class="progress-entry">' +
      '<div class="progress-entry-top"><strong>' + dateLabel + '</strong><b>' +
      (Number.isFinite(weight) ? weight.toLocaleString('ru-RU') + ' кг' : '—') +
      '</b></div><small>' + meal + ' · ' + workout + '</small></article>';
  }).join('');
}

async function loadProgressHistory() {
  const container = $('#progressHistory');
  if (!container) return;
  container.textContent = 'Загружаем историю…';
  try {
    const data = await api('/api/progress');
    renderProgressHistory(data.items || []);
  } catch {
    container.textContent = 'Историю прогресса пока не удалось загрузить.';
  }
}


function formatReviewDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('ru-RU');
}

function renderPremiumReviewItem(item) {
  const review = item.review || {};
  const stats = review.stats || {};
  const weightText = stats.weightChangeKg !== null && stats.weightChangeKg !== undefined
    ? 'Изменение веса по записям: ' + (Number(stats.weightChangeKg) > 0 ? '+' : '') + String(stats.weightChangeKg) + ' кг'
    : '';
  const metrics = [
    'Записей в дневнике: ' + Number(stats.trackingDays || 0),
    'Питание отмечено: ' + Number(stats.nutritionDays || 0) + ' дн.',
    'Тренировки отмечены: ' + Number(stats.workoutDays || 0) + ' дн.',
    weightText
  ].filter(Boolean);
  const observations = Array.isArray(review.observations) ? review.observations : [];
  const recommendations = Array.isArray(review.recommendations) ? review.recommendations : [];
  return '<article class="premium-review-output">' +
    '<div class="premium-review-meta">РАЗБОР ЗА НЕДЕЛЮ · ' + escapeHtml(formatReviewDate(item.createdAt)) + '</div>' +
    '<h4>' + escapeHtml(review.headline || 'Ваш недельный разбор') + '</h4>' +
    '<p>' + escapeHtml(review.summary || '') + '</p>' +
    '<div class="premium-review-metrics">' + metrics.map(value => '<span>' + escapeHtml(value) + '</span>').join('') + '</div>' +
    (observations.length ? '<h5>Что видно по дневнику</h5><ul>' + observations.map(value => '<li>' + escapeHtml(value) + '</li>').join('') + '</ul>' : '') +
    (recommendations.length ? '<h5>Что сделать на следующей неделе</h5><ul>' + recommendations.map(value => '<li>' + escapeHtml(value) + '</li>').join('') + '</ul>' : '') +
    (review.nextWeekFocus ? '<div class="premium-review-focus"><small>ГЛАВНЫЙ ФОКУС</small><strong>' + escapeHtml(review.nextWeekFocus) + '</strong></div>' : '') +
    '<small class="premium-review-disclaimer">' + escapeHtml(review.disclaimer || '') + '</small>' +
  '</article>';
}

function renderPremiumReviews(data) {
  const reviews = Array.isArray(data.reviews) ? data.reviews : [];
  const current = reviews.find(item => item.periodStart === data.periodStart);
  const button = $('#premiumReviewButton');
  button.disabled = !data.canGenerate;
  button.textContent = current
    ? 'Разбор этой недели готов'
    : data.progressEntries >= 2 ? 'Подготовить разбор недели ↗' : 'Добавьте записи в дневник';
  $('#premiumReviewMessage').textContent = current
    ? 'Разбор за текущую неделю сохранён. Новый отчёт станет доступен на следующей неделе.'
    : 'Записей за эту неделю: ' + Number(data.progressEntries || 0) + ' из 2 необходимых для разбора.';
  $('#premiumReviewResult').innerHTML = current
    ? renderPremiumReviewItem(current)
    : '<p class="premium-review-empty">Здесь появится персональный разбор после накопления записей в дневнике.</p>';
  const history = reviews.filter(item => item.periodStart !== data.periodStart);
  $('#premiumReviewHistory').innerHTML = history.length
    ? '<h4>Предыдущие разборы</h4>' + history.map(renderPremiumReviewItem).join('')
    : '';
}

async function loadPremiumReviews() {
  const result = $('#premiumReviewResult');
  if (result) result.textContent = 'Загружаем историю разборов…';
  try {
    const data = await api('/api/premium/review');
    renderPremiumReviews(data);
  } catch (error) {
    $('#premiumReviewMessage').textContent = error.message || 'Не удалось загрузить историю разборов.';
    $('#premiumReviewButton').disabled = false;
    $('#premiumReviewButton').textContent = 'Повторить загрузку ↻';
  }
}

function fillProfileForm(profile) {
  const form = $('#profileUpdateForm');
  if (!form || !profile) return;
  for (const [key, value] of Object.entries(profile)) {
    const field = form.elements.namedItem(key);
    if (field && value !== null && value !== undefined) field.value = String(value);
  }
}

function profileFromFields(fields) {
  return {
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
}

async function loadProfileEditor() {
  try {
    const data = await api('/api/profile');
    fillProfileForm(data.profile);
  } catch {
    const message = $('#profileMessage');
    if (message) message.textContent = 'Не удалось загрузить анкету. Повторите попытку позже.';
  }
}

function renderMeal(day, label, key) {
  const ingredients = Array.isArray(day[key + 'Ingredients']) ? day[key + 'Ingredients'] : [];
  const composition = ingredients.map(item =>
    escapeHtml(item.name) + ' — ' + Number(item.grams).toLocaleString('ru-RU') + ' г'
  ).join(' · ');
  return '<p><strong>' + label + '</strong> · ' + escapeHtml(day[key]) +
    (composition ? '<br><small>Состав, вес до приготовления: ' + composition + '</small>' : '') +
    (day[key + 'Recipe'] ? '<br><small>Приготовление: ' + escapeHtml(day[key + 'Recipe']) + '</small>' : '') + '</p>';
}

function renderFullPlan(plan, targetSelector) {
  const target = $(targetSelector || '#fullPlan');
  const days = Array.isArray(plan.week) ? plan.week : [];
  const average = plan.dailyAverage || {};
  const hasFullMacros = Number.isFinite(Number(average.fat)) && Number.isFinite(Number(average.carbs)) && Number.isFinite(Number(plan.fat)) && Number.isFinite(Number(plan.carbs));
  const nutritionSummary = plan.dailyAverage
    ? '<p class="nutrition-summary">Ориентир по анкете: ' +
      Number(plan.calories || 0).toLocaleString('ru-RU') + ' ккал · белки ' +
      Number(plan.protein || 0).toLocaleString('ru-RU') + ' г' +
      (hasFullMacros ? ' · жиры ' + Number(plan.fat).toLocaleString('ru-RU') + ' г · углеводы ' + Number(plan.carbs).toLocaleString('ru-RU') + ' г' : '') +
      ' в день. Среднее меню по составу продуктов: ' +
      Number(average.calories || 0).toLocaleString('ru-RU') + ' ккал · белки ' +
      Number(average.protein || 0).toLocaleString('ru-RU') + ' г' +
      (hasFullMacros ? ' · жиры ' + Number(average.fat).toLocaleString('ru-RU') + ' г · углеводы ' + Number(average.carbs).toLocaleString('ru-RU') + ' г' : ' · жиры и углеводы не рассчитаны в сохранённой старой версии') +
      '.</p>'
    : '<p class="nutrition-summary">Эта программа создана до обновления расчёта по ингредиентам. Чтобы получить проверяемые порции, калории и список покупок, пересоберите план в анкете.</p>';
  target.innerHTML = nutritionSummary + days.map(function (day) {
    const nutrition = day.nutrition || {};
    return '<article class="day-card">' +
      '<h3>' + escapeHtml(day.day) + '</h3>' +
      renderMeal(day, 'Завтрак', 'breakfast') +
      renderMeal(day, 'Обед', 'lunch') +
      renderMeal(day, 'Перекус', 'snack') +
      renderMeal(day, 'Ужин', 'dinner') +
      (day.nutrition ? '<p class="day-nutrition"><strong>Расчёт по продуктам:</strong> ' +
        Number(nutrition.calories).toLocaleString('ru-RU') + ' ккал · ' +
        Number(nutrition.protein).toLocaleString('ru-RU') + ' г белка' +
        (Number.isFinite(Number(nutrition.fat)) && Number.isFinite(Number(nutrition.carbs)) ? ' · ' + Number(nutrition.fat).toLocaleString('ru-RU') + ' г жиров · ' + Number(nutrition.carbs).toLocaleString('ru-RU') + ' г углеводов' : ' · жиры и углеводы не рассчитаны в старой версии') +
        '</p>' : '') +
      '<p class="day-workout"><strong>' + (day.trainingDay ? 'Тренировка' : 'Отдых и активность') + '</strong><br>' + escapeHtml(day.workout) + '</p>' +
      '</article>';
  }).join('');
  if (plan.shopping && plan.shopping.length) {
    target.insertAdjacentHTML('beforeend',
      '<article class="day-card"><h3>' + (plan.nutritionSource ? 'Список покупок на весь срок' : 'Список покупок') + '</h3><p>' +
      plan.shopping.map(escapeHtml).join('</p><p>') + '</p>' +
      (plan.nutritionSource ? '<small>Количество рассчитано суммированием ингредиентов всех дней. Мясо, рыба, овощи и фрукты — сырые съедобные части; крупы и бобовые — сухой вес.</small>' : '') + '</article>');
  }
  if (plan.tips && plan.tips.length) {
    target.insertAdjacentHTML('beforeend',
      '<article class="day-card"><h3>Рекомендации</h3><p>' +
      plan.tips.map(escapeHtml).join('</p><p>') + '</p></article>');
  }
  if (plan.nutritionSource) target.insertAdjacentHTML('beforeend',
    '<p class="nutrition-source">' + escapeHtml(plan.nutritionSource) + '</p>');
}

async function loadAccount() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return false;
  try {
    const [me, planData] = await Promise.all([api('/api/me'), api('/api/plan')]);
    const subscription = me.subscription || {};
    syncTrainingFields($('#profileUpdateForm'), subscription.plan);
    $('#accountPlanName').textContent = 'Тариф ' + (subscription.plan || 'Fital Pro');
    $('#accountExpiry').textContent = subscription.expires_at
      ? 'Доступ до ' + new Date(subscription.expires_at).toLocaleDateString('ru-RU')
      : 'Подписка активна';
    $('#accountStatus').textContent = '● Подписка активна';
    const advancedFeatures = ['PRO', 'Premium'].includes(subscription.plan);
    const premiumFeatures = subscription.plan === 'Premium';
    $('#progressTool').classList.toggle('is-hidden', !advancedFeatures);
    $('#chatTool').classList.toggle('is-hidden', !advancedFeatures);
    $('#premiumReviewTool').classList.toggle('is-hidden', !premiumFeatures);
    renderFullPlan(planData.plan);
    $('#account').classList.remove('is-hidden');
    const accountTasks = [loadProfileEditor()];
    if (advancedFeatures) accountTasks.push(loadProgressHistory());
    if (premiumFeatures) accountTasks.push(loadPremiumReviews());
    await Promise.all(accountTasks);
    return true;
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      localStorage.removeItem(TOKEN_KEY);
    } else {
      showToast('Временная ошибка загрузки. Доступ сохранён — обновите страницу позже.');
    }
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

$('#profileUpdateForm').addEventListener('submit', async function (event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $('#saveProfileButton');
  const message = $('#profileMessage');
  button.disabled = true;
  button.textContent = 'ИИ обновляет вашу программу…';
  message.textContent = '';
  try {
    const profile = profileFromFields(new FormData(form));
    const data = await api('/api/profile', {
      method: 'POST',
      body: JSON.stringify(profile)
    });
    fillProfileForm(data.profile || profile);
    renderFullPlan(data.plan);
    message.textContent = 'Анкета сохранена. Персональная программа обновлена.';
    showToast('Новый план готов.');
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = 'Сохранить анкету и пересобрать план';
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
    await loadProgressHistory();
    if (!$('#premiumReviewTool').classList.contains('is-hidden')) await loadPremiumReviews();
  } catch (error) {
    $('#progressMessage').textContent = error.message;
  }
});

$('#premiumReviewButton').addEventListener('click', async function () {
  const button = $('#premiumReviewButton');
  button.disabled = true;
  button.textContent = 'ИИ анализирует дневник…';
  $('#premiumReviewMessage').textContent = '';
  try {
    await api('/api/premium/review', { method: 'POST', body: JSON.stringify({}) });
    await loadPremiumReviews();
    showToast('Недельный разбор Premium готов.');
  } catch (error) {
    $('#premiumReviewMessage').textContent = error.message;
    button.disabled = false;
    button.textContent = 'Подготовить разбор недели ↗';
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