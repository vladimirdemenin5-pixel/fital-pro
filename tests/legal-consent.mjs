import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const html = read('public/index.html');
const app = read('public/app.js');
const worker = read('_worker.js');
const schema = read('migrations/0001_init.sql');
const premiumSchema = read('migrations/0002_premium_reviews.sql');
const offer = read('public/oferta.html');
const robokassaTest = read('public/robokassa-test.html');

for (const name of ['pd_consent', 'offer_accepted']) {
  assert.match(html, new RegExp('name="' + name + '"[^>]*required'));
  assert.ok(app.includes(name + ": fields.get('" + name + "') === 'on'"));
  assert.ok(worker.includes('accepted(body?.' + name + ')'));
}
for (const page of ['oferta.html', 'privacy.html', 'delivery-refund.html', 'requisites.html']) {
  const content = read('public/' + page);
  assert.match(content, /<html lang="ru">/);
  assert.match(content, /Fital Pro/);
}
assert.ok(html.includes('href="/oferta.html"'));
assert.ok(html.includes('href="/privacy.html"'));
assert.match(robokassaTest, /id="age" type="number" min="18" max="90"/,
  'the Robokassa test form must match the server-side adult-only age limit');
assert.ok(worker.includes('pd_consent_at'));
assert.ok(worker.includes('pd_policy_version'));
assert.ok(worker.includes('offer_accepted_at'));
assert.ok(worker.includes('HttpOnly; Secure; SameSite=Lax'));
assert.ok(worker.includes("const checkoutCookieName = 'fitalpro_checkout_' + order.client_ref"), 'payment status must select the cookie belonging to the requested order');
assert.ok(worker.includes("checkoutCookies.find(item => item.startsWith(checkoutCookieName + '='))"), 'payment status must parse the matching per-order cookie');
assert.ok(worker.includes("fitalpro_checkout_\u0024{clientRef}=\u0024{clientRef}"), 'checkout must set a distinct cookie for each order');
assert.ok(worker.includes('checkoutCookie !== order.client_ref'));
assert.ok(worker.includes('order.status === \'paid\' && subscription?.status === \'active\''));
assert.ok(worker.includes('INNER JOIN profiles p ON p.access_token=s.access_token'));
assert.ok(worker.includes('INNER JOIN weekly_plans w ON w.access_token=s.access_token'));
assert.ok(worker.includes('s.expires_at>?)'));
assert.ok(worker.includes("'ROBOKASSA_TEST_PASSWORD' + number"));
assert.ok(worker.includes("env.ROBOKASSA_IS_TEST === '1'"));
assert.ok(worker.includes('const password1 = robokassaPassword(env, 1, testMode)'));
assert.ok(worker.includes('ROBOKASSA_TEST_ACCESS_KEY'));
assert.ok(worker.includes("url.pathname === '/api/checkout-test'"));
assert.ok(worker.includes('is_test INTEGER NOT NULL DEFAULT 0'));
assert.ok(worker.includes('const password2 = robokassaPassword(env, 2, testMode)'));
assert.ok(worker.includes("const paymentId = 'robokassa-' + (testMode ? 'test-' : '') + invId"));
assert.ok(worker.includes("params.set('SuccessUrl2', successUrl.toString())"), 'Robokassa success return must use the documented SuccessUrl2 parameter');
assert.ok(worker.includes("params.set('SuccessUrl2Method', 'GET')"), 'Robokassa success return method must be explicit');
assert.ok(worker.includes("params.set('FailUrl2', failUrl.toString())"), 'Robokassa failed-payment return must use the documented FailUrl2 parameter');
assert.ok(worker.includes("params.set('FailUrl2Method', 'GET')"), 'Robokassa failed-payment return method must be explicit');
assert.ok(worker.includes("successUrl.searchParams.set('ref', clientRef)"), 'successful return must carry the order reference for activation polling');
assert.ok(worker.includes("successUrl.searchParams.set('payment', 'success')"), 'successful return must be distinguishable from a failed payment');
assert.ok(worker.includes('buildRobokassaPaymentSignature({'), 'checkout must use the tested Robokassa payment signature helper');
assert.ok(!worker.includes("params.set('SuccessURL',"), 'legacy unrecognized success return parameter must not be sent');
assert.ok(!worker.includes("params.set('FailURL',"), 'legacy unrecognized fail return parameter must not be sent');

assert.match(schema, /client_ref TEXT NOT NULL UNIQUE/);
assert.match(schema, /payment_id TEXT NOT NULL UNIQUE/);
assert.match(schema, /access_token TEXT NOT NULL UNIQUE/);
assert.match(schema, /CREATE TABLE IF NOT EXISTS profiles/);
assert.match(schema, /CREATE TABLE IF NOT EXISTS weekly_plans/);
assert.ok(worker.includes('INSERT INTO payments'));
assert.ok(worker.includes('ON CONFLICT(payment_id) DO NOTHING'));
assert.ok(worker.includes('await saveMemberPlan(env, accessToken, profile, plan)'));
assert.ok(worker.includes('await env.DB.batch([profileStatement, planStatement])'), 'profile and weekly plan must be saved atomically in D1');
assert.ok(worker.includes("UPDATE pending_orders SET status='paid'"));
assert.ok(worker.includes('INNER JOIN profiles p'));
assert.ok(worker.includes('INNER JOIN weekly_plans w'));
assert.ok(worker.includes("if (!['PRO', 'Premium'].includes(sub.plan)) return json({ error: 'Дневник прогресса доступен на тарифах PRO и Premium.' }, 403)"));
assert.ok(worker.includes("if (!['PRO', 'Premium'].includes(sub.plan)) return json({ error: 'ИИ-консультант доступен на тарифах PRO и Premium.' }, 403)"));
assert.ok(app.includes("const advancedFeatures = ['PRO', 'Premium'].includes(subscription.plan)"));
assert.ok(app.includes("$('#progressTool').classList.toggle('is-hidden', !advancedFeatures)"));
assert.ok(app.includes("$('#chatTool').classList.toggle('is-hidden', !advancedFeatures)"));
assert.ok(html.includes('id="progressTool"'));
assert.ok(html.includes('id="chatTool"'));
assert.ok(worker.includes('trainingDay: includesTraining && source.trainingDay'), 'training-day flag must be normalized from the validated AI response');
assert.ok(worker.includes("max_completion_tokens: 6500"));
assert.ok(worker.includes("response_format: { type: 'json_object' }"));
assert.ok(worker.includes("chat_template_kwargs: { enable_thinking: false }"));
assert.ok(!worker.includes("max_tokens: 4500"));
assert.ok(worker.includes("'Питание': { amount: '990.00'"));
assert.ok(worker.includes("'PRO': { amount: '1990.00'"));
assert.ok(worker.includes("'Premium': { amount: '3990.00'"));
assert.ok(worker.includes("const includesTraining = planKey !== 'Питание'"));
assert.ok(worker.includes('plan: planKey,'));
assert.ok(worker.includes('planLabel: PLANS[planKey].label,'));
assert.ok(worker.includes("INSERT INTO pending_orders (client_ref,plan,amount,customer_contact,profile_json,plan_json"));
assert.ok(worker.includes("await saveMemberPlan(env, accessToken, profile, plan)"));
assert.ok(worker.includes("SELECT plan_json FROM weekly_plans WHERE access_token=?"));

assert.ok(worker.includes('expectedTrainingDaysInBlock(menuDays,index,profile.days)'), 'training frequency must be validated proportionally for a partial final block');
assert.ok(worker.includes('trainingSchedule.map((count, index)'), 'the AI prompt must specify the training count for every plan block');
assert.ok(worker.includes('parsed.week.length !== menuDays'), 'AI generation must validate the tariff menu duration');
assert.ok(worker.includes('function extractAiText(result)'));
assert.ok(worker.includes("result?.choices?.[0]?.message?.content"));
assert.ok(worker.includes("messages,"));
assert.ok(worker.includes("'@cf/zai-org/glm-4.7-flash'"));
assert.ok(worker.includes('runPlanModel(env, prompt, profile, planKey, menuDays)'));
assert.ok(worker.includes('normalizeAndValidatePlanWeek(parsed, profile, planKey, menuDays, nutritionTargets(profile))'), 'the server must validate structured ingredients and calculated daily nutrition');
assert.ok(worker.includes('counts.every((count,index)=>count===expectedTrainingDaysInBlock(menuDays,index,profile.days))'), 'training schedule must be checked by the server');
assert.ok(worker.includes('function buildShoppingList(week)'), 'shopping quantities must be derived from exact ingredients in the saved plan');
assert.ok(worker.includes('calculateDayNutrition(day)'), 'daily calories and protein must be calculated from ingredient weights');
assert.ok(worker.includes('targets.protein * 0.8') && worker.includes('targets.protein * 1.2'), 'daily protein must stay within validated tolerance');
assert.ok(worker.includes('profile.age < 18'), 'adult nutrition calculations must reject minors');

assert.ok(worker.includes("Не удалось пересобрать план. Сохранённая программа не изменена."));
assert.ok(worker.includes('Соблюдай указанное количество тренировок в каждом блоке'));
assert.ok(app.includes("day.trainingDay ? 'Тренировка' : 'Отдых и активность'"));
const chatStart = worker.indexOf('async function chat(request, env) {');
const leadStart = worker.indexOf('async function lead(request, env) {', chatStart);
assert.ok(chatStart >= 0 && leadStart > chatStart, 'AI chat handler must exist');
const chatSource = worker.slice(chatStart, leadStart);
assert.ok(chatSource.includes("'SELECT plan_json FROM weekly_plans WHERE access_token=?'"), 'AI consultant must load the member saved plan');
assert.ok(chatSource.includes("'Сохранённый план клиента (JSON): ' + plan"), 'AI consultant prompt must include the saved weekly plan');
assert.equal(worker.split('clean(planRow.plan_json, 24000)').length - 1, 2, 'AI chat and Premium review must receive the complete saved plan');
assert.ok(chatSource.includes('сначала опирайся на сохранённый план'), 'AI consultant must prioritize the actual plan for substitutions and workouts');
assert.ok(chatSource.includes('reply = await runAiTextWithFallback(env,'), 'AI consultant must use the primary and existing fallback model');
assert.ok(chatSource.includes('ИИ-консультант временно недоступен'), 'AI provider failures must return a controlled API error');


assert.ok(worker.includes("memberRateLimit(env, sub.access_token, 'profile-update', 5, 3600000)"), 'AI profile regeneration must be limited per active subscription');
assert.ok(worker.includes("async function premiumReviewApi(request, env)"), 'Premium weekly review API must exist');
assert.ok(worker.includes("sub.plan !== 'Premium'"), 'Premium review must be restricted to Premium');
assert.ok(worker.includes("CREATE TABLE IF NOT EXISTS premium_reviews"), 'Premium review history must persist in D1');
assert.ok(premiumSchema.includes('UNIQUE(access_token, period_start)'), 'Premium review migration must enforce one report per week');
assert.ok(worker.includes('stats,\n    disclaimer:'), 'Saved Premium review must retain its numeric diary summary');
assert.ok(worker.includes('messages: ['), 'Premium review must use the chat model message format');
assert.ok(worker.includes("UNIQUE(access_token, period_start)"), 'Only one review may be saved per member per week');
assert.ok(worker.includes("progress.length < 2"), 'Weekly review requires at least two diary entries');
assert.ok(worker.includes('progressEntries >= 2'), 'Review button readiness must be based on weekly diary records');
assert.ok(worker.includes("url.pathname === '/api/premium/review'"), 'Premium review route must be registered');
assert.ok(worker.includes("SELECT plan_json FROM weekly_plans WHERE access_token=?"), 'Premium review must use the saved personal plan');
assert.ok(app.includes("$('#premiumReviewTool').classList.toggle('is-hidden', !premiumFeatures)"));
assert.ok(app.includes("api('/api/premium/review')"));
assert.ok(html.includes('id="premiumReviewTool"'));
assert.ok(html.includes('Еженедельный ИИ-разбор дневника'));
assert.ok(offer.includes('автоматизированный ИИ-разбор дневника'));

console.log('PASS: legal/payment protections, AI plans, and Premium weekly review');
