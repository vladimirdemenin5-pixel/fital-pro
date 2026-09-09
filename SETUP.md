# Fital Pro — production setup

Сборка подготовлена под Cloudflare Workers с `_worker.js`, статическими assets и bindings.

## Что работает в коде
- `/api/chat` — Fital AI через Workers AI.
- `/api/profile` — профиль пользователя.
- `/api/plan` — персональный недельный план.
- `/api/progress` — вес и выполнение программы.
- `/api/lead` — заявки.
- `/api/checkout` — создание платежа ЮKassa.
- `/webhooks/yookassa` — подтверждение платежей.
- `/api/payment-status` — статус платежа.
- `/api/me` — статус подписки.
- `/health` — диагностика.

## Быстрый запуск

```bash
npm install
npx wrangler login
npm run deploy
```

Wrangler 4.68+ умеет автоматически настраивать существующие проекты, а Cloudflare также поддерживает автоматическое provision для ряда bindings при конфигурации без resource ID. При необходимости D1 можно создать отдельно и указать `database_id` в `wrangler.jsonc`.

## Secrets

```bash
npx wrangler secret put YOOKASSA_SHOP_ID
npx wrangler secret put YOOKASSA_SECRET_KEY
```

Никогда не помещайте эти значения в `public/`.

## ЮKassa

Webhook:

`https://YOUR_DOMAIN/webhooks/yookassa`

Минимальное событие: `payment.succeeded`.

## После deploy

Проверить:

`https://YOUR_DOMAIN/health`

Нужно получить `ok: true`, а после настройки bindings/secrets — `ai: true`, `db: true`, `payments: true`.

## Доступ
После успешной оплаты подписка активируется на 30 дней. Токен выдаётся только после подтверждения успешного платежа по уникальному `client_ref`.
