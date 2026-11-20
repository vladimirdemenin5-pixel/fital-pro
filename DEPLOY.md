# Fital Pro — безопасная публикация

## Текущее состояние

- Продолжаем существующий Worker `red-waterfall-2af8`.
- Production D1: `fital-pro-db`.
- Preview D1: `fital-pro-preview-db`.
- Сайт находится в `public/`, SQL-миграции — в `migrations/`.
- PR #1 остаётся Draft; ветка не объединена с `main`.
- Production Worker и Production D1 этой веткой не изменялись.

## Проверка исходного кода

```bash
npm install
npm run check
npm test
npm run build
```

Build больше не извлекает содержимое `Fital_Pro_PRODUCTION_GITHUB_READY.zip`. Архив оставлен в репозитории как старый артефакт, но не используется для сборки. Скрипт `scripts/extract-release.mjs` отключён, поскольку он мог затереть текущие файлы сайта и миграций.

## Preview: сначала тестовая среда

Текущая ветка содержит Preview-настройки в `wrangler.jsonc`:

- отдельная D1 `fital-pro-preview-db`;
- Workers AI binding;
- `ROBOKASSA_IS_TEST=1`;
- test payment mode.

В Cloudflare Preview Base добавляются отдельные Secrets:

- `ROBOKASSA_MERCHANT_LOGIN`;
- `ROBOKASSA_TEST_PASSWORD1`;
- `ROBOKASSA_TEST_PASSWORD2`.

Не устанавливайте тестовые пароли как Production Secrets и не копируйте live-пароли в Preview.

Порядок:

1. `npm run db:migrations:list:preview` — просмотреть ожидающие миграции.
2. `npm run db:migrate:preview` — применить только к Preview D1 после просмотра списка.
3. `npm run preview` — создать Preview этого Worker по текущей ветке.
4. Проверить `/health`: AI и D1 должны быть доступны, `paymentMode` должен быть `test`.
5. Проверить тарифы 7/14/30 дней, генерацию меню, список покупок, корректные права для тренировок, тестовый платёж, POST ResultURL и выдачу доступа.

Preview создаётся на существующем Worker через механизм Worker Previews; новый Worker service не создаётся.

## Robokassa

В технических настройках магазина:

- Result URL: `https://<preview-host>/webhooks/robokassa`;
- Result URL method: POST;
- Result notification password: тестовый Password #2;
- Success URL: `https://<preview-host>/`, method GET;
- Fail URL: `https://<preview-host>/?payment=failed`, method GET;
- hash algorithm должен совпадать с настройкой магазина.

В Production live checkout закрыт кодом, пока переменная `ROBOKASSA_LIVE_ENABLED` не установлена в `1`. Не включайте её до проверки тестового платежа и публикации реальных реквизитов продавца.

## Production release — отдельный этап

Только после успешных Preview-проверок и отдельного разрешения:

1. Проверить юридические страницы и реальные реквизиты продавца.
2. Убедиться, что Production secrets `ROBOKASSA_MERCHANT_LOGIN`, `ROBOKASSA_PASSWORD1`, `ROBOKASSA_PASSWORD2` настроены в Production Worker.
3. Сверить Production D1 schema и статус миграций.
4. После явного согласования включить `ROBOKASSA_LIVE_ENABLED=1`.
5. Отдельно согласовать Production deploy и необходимые Production D1 migrations.

Не запускайте `npm run db:migrate` или `npm run deploy` во время Preview-тестирования.

## GitHub Actions

Workflow проверяет Worker и frontend syntax, выполняет регрессионные тесты, локальную проверку миграций D1 и Wrangler dry-run. Он не разворачивает Worker и не применяет remote D1 migrations.


Миграция `0011_one_payment_per_draft.sql` предотвращает создание двух счетов из одного AI-черновика. Она входит в общий список Preview-миграций и не должна применяться к Production до отдельного согласования.
